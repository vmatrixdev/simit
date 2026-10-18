import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_PATH = path.resolve(__dirname, '../tests/eval/dataset.json');
const REPORT_PATH = path.resolve(__dirname, '../eval-report.md');
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/eval-screenshots');

// Ensure screenshots dir exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// Ensure the dist sandbox path exists for injection
const SANDBOX_DIR = path.resolve(__dirname, '../dist/src/sandbox');
const SANDBOX_HTML_PATH = path.join(SANDBOX_DIR, 'sandbox.html');

interface DatasetEntry {
  id: string;
  concept: string;
  description: string;
  mathSnippets?: string[];
}

interface EvalResult {
  id: string;
  scores: {
    visualIntrigue: number;
    epistemicTruth: number;
    interactiveResponsiveness: number;
    structuralSoundness: number;
  };
  rationale: string;
}

// Function to generate simulation via mock/local provider or direct OpenAI call
async function generateSimulationCode(entry: DatasetEntry, openai: OpenAI): Promise<string> {
    console.log(`[Eval] Generating simulation for: ${entry.concept}`);

    const { buildSimulationSystemPrompt } = await import('../src/providers/prompt-builder.js');
    const systemPrompt = buildSimulationSystemPrompt({ width: 500, height: 600 });

    const prompt = `Translate the following concept into a single JavaScript ES module adhering to the SimIt simEngine contract.

Concept: ${entry.concept}
Description: ${entry.description}
Math: ${entry.mathSnippets ? entry.mathSnippets.join('; ') : 'N/A'}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o", // Using gpt-4o for code generation in eval script
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ],
            temperature: 0.2
        });

        const content = response.choices[0].message.content || "";
        const match = content.match(/<simulation_code>([\s\S]*?)<\/simulation_code>/);
        if (match && match[1]) {
            let code = match[1].trim();
            // simple sanitization
            code = code.replace(/^```javascript\n/, '').replace(/\n```$/, '');
            code = code.replace(/^```js\n/, '').replace(/\n```$/, '');
            return code;
        } else {
             // fallback parsing if tags missing
             const codeMatch = content.match(/```javascript([\s\S]*?)```/);
             if (codeMatch && codeMatch[1]) return codeMatch[1].trim();
             return content;
        }
    } catch (e: any) {
        console.error("Error generating code", e);
        return "";
    }
}

// Playwright runner
async function testSimulationInPlaywright(id: string, code: string): Promise<{ initialScreenshot: string, finalScreenshot: string, logs: string[] }> {
    console.log(`[Eval] Running Playwright for: ${id}`);

    // We need to inject the code into a mock HTML that resembles sandbox.html
    const tempHtmlPath = path.join(SCREENSHOTS_DIR, `${id}-sandbox.html`);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
      body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #090d16; color: white; }
      #sim-root { width: 100%; height: 100%; }
    </style>
    <!-- Include basic vendor scripts from CDN for evaluation standalone mode -->
    <script src="https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js"></script>
</head>
<body>
    <div id="sim-root"></div>
    <script type="module">
        const codeString = \`${code.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
        // Create blob and import
        const blob = new Blob([codeString], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        import(url).then(module => {
            const sim = module.default;
            const container = document.getElementById('sim-root');

            // Setup Tweakpane
            const tp = new Tweakpane.Pane({ container: document.body, title: sim.title });
            tp.element.style.position = 'absolute';
            tp.element.style.top = '10px';
            tp.element.style.right = '10px';
            tp.element.style.zIndex = '9999';

            const paramsObj = {};
            if (sim.parameters) {
                sim.parameters.forEach(p => {
                    paramsObj[p.id] = p.default;
                    tp.addBinding(paramsObj, p.id, { min: p.min, max: p.max, step: p.step, label: p.label }).on('change', () => {
                        if (sim.update) sim.update(paramsObj);
                    });
                });
            }

            if (sim.init) sim.init(container, paramsObj);
        }).catch(err => {
            console.error("Module import error", err);
        });
    </script>
</body>
</html>
    `;

    fs.writeFileSync(tempHtmlPath, htmlContent);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setViewportSize({ width: 500, height: 600 });

    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => logs.push(`[error] ${err.message}`));

    await page.goto(`file://${tempHtmlPath}`);

    // Wait for init
    await page.waitForTimeout(1000);

    const initialScreenshot = path.join(SCREENSHOTS_DIR, `${id}-initial.png`);
    await page.screenshot({ path: initialScreenshot });

    // Try to find a tweakpane slider and move it
    try {
        const slider = await page.$('.tp-sldtxtv_sld'); // tweakpane slider class
        if (slider) {
            const box = await slider.boundingBox();
            if (box) {
                // Click middle of slider
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                await page.waitForTimeout(500);
            }
        }
    } catch (e) {
        console.log("Could not manipulate slider for", id);
    }

    const finalScreenshot = path.join(SCREENSHOTS_DIR, `${id}-final.png`);
    await page.screenshot({ path: finalScreenshot });

    await browser.close();

    return { initialScreenshot, finalScreenshot, logs };
}


// Evaluate simulation
async function evaluateSimulation(entry: DatasetEntry, code: string, logs: string[], openai: OpenAI): Promise<EvalResult> {
    const prompt = `
You are an expert design and engineering judge evaluating an interactive simulation generated for the concept: "${entry.concept}".

### Simulation Code:
\`\`\`javascript
${code.substring(0, 3000)} // Truncated for length
\`\`\`

### Runtime Logs:
${logs.join('\n') || "No errors."}

Evaluate the simulation on a scale of 1-5 for the following criteria:
1. **VisualIntrigue**: Is the UI layout visually compelling, animated, and engaging (not just a static slide)?
2. **EpistemicTruth**: Does it correctly represent the specific domain and give insight into the inner mechanics?
3. **InteractiveResponsiveness**: Do parameter changes have a revealing and immediate effect?
4. **StructuralSoundness**: Is the code defensively written, clean, and free of obvious visual bugs or infinite loops (check logs)?

Return ONLY a JSON object with this exact structure:
{
  "scores": {
    "visualIntrigue": number,
    "epistemicTruth": number,
    "interactiveResponsiveness": number,
    "structuralSoundness": number
  },
  "rationale": "A concise paragraph explaining the scores."
}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o", // Using gpt-4o as Judge
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        });

        const resultText = response.choices[0].message.content || "{}";
        return {
            id: entry.id,
            ...JSON.parse(resultText)
        };
    } catch (e) {
        console.error("Evaluation failed", e);
        return {
            id: entry.id,
            scores: { visualIntrigue: 0, epistemicTruth: 0, interactiveResponsiveness: 0, structuralSoundness: 0 },
            rationale: "Evaluation failed due to LLM error."
        };
    }
}

async function runEvaluations() {
    console.log("Starting Evaluation Framework...");
    if (!process.env.EVAL_OPENAI_API_KEY) {
        console.error("Please set EVAL_OPENAI_API_KEY in .env");
        process.exit(1);
    }

    const openai = new OpenAI({ apiKey: process.env.EVAL_OPENAI_API_KEY });
    const dataset: DatasetEntry[] = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));

    let reportContent = "# SimIt Evaluation Report\n\n";
    let totalScore = 0;

    for (const entry of dataset) {
        // 1. Generate code
        const code = await generateSimulationCode(entry, openai);
        if (!code) {
             reportContent += `## ${entry.concept} \n Failed to generate code.\n\n`;
             continue;
        }

        // 2. Playwright execution
        const { initialScreenshot, finalScreenshot, logs } = await testSimulationInPlaywright(entry.id, code);

        // 3. Evaluate
        const evalResult = await evaluateSimulation(entry, code, logs, openai);

        const sum = evalResult.scores.visualIntrigue + evalResult.scores.epistemicTruth + evalResult.scores.interactiveResponsiveness + evalResult.scores.structuralSoundness;
        totalScore += sum;

        reportContent += `## ${entry.concept} (ID: ${entry.id})\n`;
        reportContent += `- **Visual Intrigue**: ${evalResult.scores.visualIntrigue}/5\n`;
        reportContent += `- **Epistemic Truth**: ${evalResult.scores.epistemicTruth}/5\n`;
        reportContent += `- **Interactive Responsiveness**: ${evalResult.scores.interactiveResponsiveness}/5\n`;
        reportContent += `- **Structural Soundness**: ${evalResult.scores.structuralSoundness}/5\n`;
        reportContent += `- **Total Score**: ${sum}/20\n\n`;
        reportContent += `**Rationale:** ${evalResult.rationale}\n\n`;
        reportContent += `*Logs:* ${logs.length > 0 ? logs.join('; ') : "No errors"}\n\n`;
        reportContent += `---\n\n`;

        console.log(`[Eval] Finished: ${entry.concept} (Score: ${sum}/20)`);
    }

    const average = totalScore / dataset.length;
    reportContent = `## Average Score: ${average.toFixed(2)}/20\n\n` + reportContent;

    fs.writeFileSync(REPORT_PATH, reportContent);
    console.log(`Evaluation complete. Report saved to ${REPORT_PATH}`);
}

runEvaluations().catch(err => {
    console.error("Evaluation framework crashed:", err);
});
