# OpenRouter Agent CLI

AI Agent CLI powered by OpenRouter API - clean UI with code execution support.

## Features

- 🤖 **Agent Mode** - AI uses tools to complete tasks
- 📝 **File Operations** - Read, write, edit files with diff preview
- 🔍 **Code Search** - Grep and find files
- ⚡ **Code Execution** - Compile and run C/C++, Python, JavaScript, Rust, Go, Java
- 💬 **Interactive Chat** - Clean conversational interface with spinner
- 📦 **Session Management** - Persistent working directory

## Installation

```bash
npm install
npm link
```

## Configuration

Create `.env` file:

```bash
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=arcee-ai/trinity-large-preview:free
```

## Usage

```bash
# Agent mode
openrouter-cli --agent

# Change model during chat
/model openai/gpt-oss-120b:free

# Clear conversation
clear
```

## Available Tools

- `read_file` - Read file content
- `write_file` - Create new file
- `str_replace` - Edit existing file (shows diff)
- `list_dir` - List directory contents
- `grep` - Search patterns in files
- `find_files` - Find files by name
- `execute` - Compile and run code files

## Examples

```
You: Create hello.cpp that prints "Hello World" and run it
AI: [creates file, compiles, executes]

You: Change "Hello" to "Hi" in hello.cpp
AI: [shows diff, applies change]
```

## Free Models

- `arcee-ai/trinity-large-preview:free` - Default
- `openai/gpt-oss-120b:free` - Large model
- `z-ai/glm-4.5-air:free` - Fast
- `stepfun/step-3.5-flash:free` - Very fast

More: https://openrouter.ai/models?order=newest&supported_parameters=tools

## License

MIT
