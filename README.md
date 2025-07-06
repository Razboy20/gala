# 🎭 GALA: Git Author Line Analyzer

Gala is a command-line tool that analyzes git repository data to provide you insights about author contributions by line count.

I've found that the available tools don't provide this functionality, and I wanted to create a simple, fast, and efficient way to see, at a glance, who really wrote what in a codebase.

## Features

- 📊 View contributions of all authors across a repository
- 🔍 Analyze line contributions for a specific user, or
- 📝 Display per-file contribution breakdowns

- 🚀 Parallel processing of files
- 🧠 Filtering of binary and generated files
- 🔧 Respects .gitignore rules automatically

## Installation

Gala is built with [Bun](https://bun.sh).

### Preferred Method (No Installation Required)

Run Gala directly using Bun:

```bash
# Run directly without installation
bunx github:razboy20/gala
```

<details>
<summary>Manual Installation and Usage</summary>

### Installation

```bash
# Clone the repository
git clone https://github.com/razboy20/gala.git
cd gala

# Install dependencies
bun install
```

### Usage after Manual Installation

```bash
# Basic usage - show all authors across the current directory
bun gala.ts

# Analyze a specific directory
bun gala.ts /path/to/project

# Show specific user's contributions per file
bun gala.ts . "Jane Doe"

# Analyze a specific user in a different directory
bun gala.ts /path/to/repo "John Smith"

# Show help information
bun gala.ts --help
```
</details>

## Usage

```bash
# Basic usage - show all authors across the current directory
bunx github:razboy20/gala

# Analyze a specific directory
bunx github:razboy20/gala /path/to/project

# Show specific user's contributions per file
bunx github:razboy20/gala . "Jane Doe"

# Analyze a specific user in a different directory
bunx github:razboy20/gala /path/to/repo "John Smith"

# Show help information
bunx github:razboy20/gala --help
```

## Example Output

### All Authors Mode

```
🔍 GALA - Git Author Line Analyzer
ℹ Scanning directory: /path/to/project
✓ Loaded 15 patterns from .gitignore
Found 150 files to analyze...

📊 Processing Files
⚡ Batch 3/3 █████████████████████████ 100% (150/150)

🏆 Author Contributions by Lines

┌────────┬────────────┬────────────────────────────────────────────────────────────┐
│ Rank   │ Lines      │ Author                                                     │
├────────┼────────────┼────────────────────────────────────────────────────────────┤
│ 🥇     │ 5,238      │ Jane Doe                                                   │
│ 🥈     │ 3,102      │ John Smith                                                 │
│ 🥉     │ 2,841      │ Alex Johnson                                               │
│ 4.     │ 1,523      │ Chris Williams                                             │
│ 5.     │ 1,005      │ Sam Taylor                                                 │
└────────┴────────────┴────────────────────────────────────────────────────────────┘

 SUMMARY
┌───────────────────────┬───────────┐
│ Total lines analyzed  │ 13,709    │
│ Unique authors        │ 5         │
│ Files processed       │ 150       │
└───────────────────────┴───────────┘
```

### Single Author Mode

```
🔍 GALA - Git Author Line Analyzer
ℹ Scanning directory: /path/to/project
ℹ Analyzing contributions by user: Jane Doe
✓ Loaded 15 patterns from .gitignore
Found 150 files to analyze...

📊 Processing Files
⚡ Batch 3/3 █████████████████████████ 100% (150/150)

📝 Jane Doe's Contributions by File

┌──────────┬────────────────────────────────────────────────────────────────────────────────────┐
│ Lines    │ File                                                                               │
├──────────┼────────────────────────────────────────────────────────────────────────────────────┤
│ 842      │ src/components/dashboard/Dashboard.tsx                                             │
│ 573      │ src/utils/helpers.ts                                                               │
│ 498      │ src/features/auth/authSlice.ts                                                     │
│ 421      │ src/api/endpoints.ts                                                               │
└──────────┴────────────────────────────────────────────────────────────────────────────────────┘
... and 35 more files

 SUMMARY
┌────────────────────────┬────────────┐
│ Total lines by Jane Doe│ 5,238      │
│ Files contributed to   │ 39         │
│ Files processed        │ 150        │
└────────────────────────┴────────────┘
```

## How It Works

GALA uses `git blame` under the hood to analyze each file in the repository. It:

1. Scans the repository for files, excluding those in .gitignore and common binary formats
2. Processes files in parallel batches for improved performance
3. Parses git blame output to extract author information
4. Aggregates statistics and presents them in a readable format

It automatically handles special cases like:
- Binary files (images, videos, etc.)
- Build artifacts and dependencies
- Files listed in .gitignore

## Customization

You can modify the file exclusion patterns in the `excludePatterns` array in `gala.ts` to exclude more or less files.

## Future Improvements

- Rewrite into Go or Rust for dependency-less operation (single binary distribution)
- Add more detailed statistics (commits, file types, change over time)
- Support for more configuration options via CLI flags
- Further performance optimizations for large repositories
- Interactive TUI mode for exploring results
- Export to various formats (CSV, JSON, HTML)


## Requirements

- [Bun](https://bun.sh) runtime
- Git installed and accessible in PATH

## License

MIT
