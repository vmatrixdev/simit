# Git Execution in Sandbox Mode

When running `git` commands via `run_command` in this workspace:
- The user's system has an external git config file at `/Users/waqqasmeraj/.gitconfig-vmatrixdev` which is outside the workspace sandbox.
- Standard `git` commands fail with: `fatal: unable to access '/Users/waqqasmeraj/.gitconfig-vmatrixdev': Operation not permitted`.
- **MANDATORY RULE**: ALWAYS prefix any git command with `GIT_CONFIG_GLOBAL=/dev/null` upfront:
  ```bash
  GIT_CONFIG_GLOBAL=/dev/null git status
  GIT_CONFIG_GLOBAL=/dev/null git checkout ...
  GIT_CONFIG_GLOBAL=/dev/null git diff ...
  GIT_CONFIG_GLOBAL=/dev/null git log -n 5
  ```
- Never execute bare `git` commands without this prefix.
