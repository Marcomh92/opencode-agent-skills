# Quick Git Reference

## Basics
```bash
git status                          # See what's changed
git add .                           # Stage all changes
git commit -m "message"             # Commit staged changes
git push                            # Push to GitHub
git pull                            # Pull latest changes from GitHub
```

## Undo Mistakes

### Undo last commit (keep changes)
```bash
git reset --soft HEAD~1
```

### Undo last commit (discard changes)
```bash
git reset --hard HEAD~1
```

### Unstage a file
```bash
git restore --staged filename
```

### Discard local changes to a file
```bash
git restore filename
```

## Reverting

### Revert a specific commit (creates new "undo" commit)
```bash
git revert --no-edit <hash>
```
**Important:** This undoes ONLY that commit, not all commits up to it.

### Revert has conflicts?
```bash
git revert --abort          # Cancel and go back
git revert --skip           # Skip this commit
git revert --continue       # After fixing conflicts manually
```

## Resetting (DESTRUCTIVE)

### Reset to a specific commit (discards everything after)
```bash
git reset --hard <hash>
```

## Checking Out

### View an old commit (read-only)
```bash
git checkout <hash>
git checkout main           # Return to main branch
```

## Stashing (save work without committing)
```bash
git stash                   # Save current changes
git stash pop               # Restore stashed changes
git stash list              # See all stashes
```

## Branching
```bash
git branch                  # List branches
git branch new-name         # Create branch
git checkout new-name       # Switch to branch
git checkout -b new-name    # Create and switch
```

## Pulling Changes

### Pull latest changes from remote
```bash
git pull origin main        # Pull from main branch
git pull                    # Pull from current tracked branch
```

### Force overwrite local files with remote (DESTRUCTIVE)
```bash
git fetch origin
git reset --hard origin/main
```
**Warning:** This overwrites ALL tracked local files. Untracked files remain.

### Remove untracked files
```bash
git clean -fd               # Remove untracked files and folders
```
**Warning:** This permanently deletes untracked files!

## Useful Flags
```bash
git log --oneline           # Compact history
git log --all --graph       # Visual branch history
git diff                    # See unstaged changes
git diff --cached           # See staged changes
```

## Scripts in this folder
- `00-init-repo.cmd` - Initialize a new repo and set up .gitignore
- `01-list-commits.cmd` - Show commit history
- `02-push-commit.cmd` - Commit and push changes
- `03-repo-manager.cmd` - Repository management (revert, checkout, reset, pull)
- `05-add-to-gitignore.cmd` - Add entries to .gitignore
- `06-clone-repo.cmd` - Clone a repository from GitHub

## Golden Rule
When in doubt, **revert** is safe (creates new commit). **Reset** is dangerous (deletes history).
