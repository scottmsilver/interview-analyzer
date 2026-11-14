# Repository Guidelines

## UI Feel & Product Copy

Keep the end-user interface clean, calm, and jargon-free, following [BRAND_GUIDELINES.md](./BRAND_GUIDELINES.md):

- **Never leak internal model names or agent plumbing in the UI**: Do not show LLM/model names or codenames (such as Gemini, Hydrogen, Fable, Opus, Sonnet, Claude, GPT), internal method/harness names (`pi-agent`, `Pi Agent`), decorative stars/emojis, or raw internal benchmark scores (`8.5/10`) in user-facing labels, descriptions, status text, or activity logs.
- **Describe capability and wait time simply**: Present analysis modes by speed/depth and approximate duration (for example, `Fast (~1.5 min)` and `Deep (~4 min)`). Keep exact model identifiers strictly inside request payloads (`model`), backend configuration, and engineering docs.
- **Follow voice and tone standards**: Use active, approachable, non-technical copy and keep emojis out of production UI controls.
