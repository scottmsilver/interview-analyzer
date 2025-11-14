# Contributing to Interview Analyzer

Thank you for your interest in contributing to Interview Analyzer! This document provides guidelines and instructions for contributing.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Security](#security)
- [Questions](#questions)

## Code of Conduct

### Our Standards
- Be respectful and inclusive
- Welcome constructive feedback
- Focus on what's best for the project
- Show empathy towards others

## Getting Started

### Prerequisites
- Node.js 18 or higher
- npm or yarn
- Git
- Firebase account (for testing)
- Anthropic API key (for AI features)

### Initial Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/interview-analyzer.git
   cd interview-analyzer
   ```

2. **Install Dependencies**
   ```bash
   # Frontend
   cd frontend
   npm install

   # Backend
   cd ../backend
   npm install
   ```

3. **Environment Setup**
   Create `.env` files (never commit these!):

   **frontend/.env**
   ```env
   VITE_API_URL=http://localhost:3001
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   ```

   **backend/.env**
   ```env
   ANTHROPIC_API_KEY=your_anthropic_api_key
   PORT=3001
   ```

4. **Run Development Servers**
   ```bash
   # Frontend (in frontend directory)
   npm run dev

   # Backend (in backend directory)
   npm run dev
   ```

## Development Workflow

### Branch Strategy
- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/feature-name` - New features
- `fix/bug-name` - Bug fixes
- `docs/description` - Documentation updates

### Creating a Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### Testing Your Changes
1. **Frontend Build Test**
   ```bash
   cd frontend
   npm run build
   ```

2. **Lint Check**
   ```bash
   npm run lint
   ```

3. **Manual Testing**
   - Test on multiple browsers (Chrome, Firefox, Safari)
   - Test responsive design (mobile, tablet, desktop)
   - Test with different interview types
   - Test file upload functionality
   - Test streaming analysis

## Coding Standards

### TypeScript/JavaScript
- Use TypeScript for all new code
- Follow existing code style (check `.eslintrc`)
- Use meaningful variable and function names
- Add JSDoc comments for complex functions
- Avoid `any` types - use proper typing

### React Components
- Use functional components with hooks
- Keep components small and focused
- Extract reusable logic into custom hooks
- Use CSS Modules for styling
- Follow the component structure in ARCHITECTURE_V2.md

### CSS
- Follow the design system in BRAND_GUIDELINES.md
- Use CSS variables for colors
- Use rem units for spacing
- Mobile-first responsive design
- BEM-like naming convention

### File Organization
```
src/
├── components/     # Reusable components
├── hooks/          # Custom React hooks
├── services/       # API and Firebase services
├── utils/          # Utility functions
├── types/          # TypeScript type definitions
└── assets/         # Images, fonts, etc.
```

## Commit Guidelines

### Commit Message Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples
```
feat(analysis): add support for Amazon PM interview type

- Added new interview type constant
- Updated agent prompt template
- Added UI selector option

Closes #123
```

```
fix(upload): handle large file uploads gracefully

Previously, files over 10MB would cause the upload to fail.
Now using chunked upload for files larger than 5MB.

Fixes #456
```

## Pull Request Process

### Before Submitting
1. **Update Documentation**
   - Update README if needed
   - Update ARCHITECTURE_V2.md for structural changes
   - Update AGENT.md for AI-related changes
   - Update BRAND_GUIDELINES.md for UI changes

2. **Security Check**
   - No API keys or credentials in code
   - No `.env` files committed
   - No hard-coded server URLs
   - Input validation added where needed

3. **Test Everything**
   - Build passes
   - Lint passes
   - Manual testing complete
   - No console errors

### Submitting the PR
1. Push your branch to your fork
2. Create a Pull Request to the `develop` branch
3. Fill out the PR template completely
4. Link related issues
5. Add screenshots for UI changes
6. Request review from maintainers

### PR Review Process
- At least one maintainer approval required
- All CI checks must pass
- No merge conflicts
- Documentation updated
- Code follows style guidelines

### After Approval
- Squash and merge or rebase as appropriate
- Delete your feature branch
- Close related issues

## Security

### Reporting Security Issues
**DO NOT** create public issues for security vulnerabilities.

Instead, email security details to the maintainers privately.

### Security Best Practices
1. **Never commit sensitive data**
   - API keys
   - Credentials
   - Environment files (except `.env.example`)
   - Firebase configuration files

2. **Input Validation**
   - Validate all user inputs
   - Sanitize file uploads
   - Check file types and sizes

3. **Authentication**
   - Use Firebase Auth properly
   - Check user permissions
   - Validate tokens

4. **API Security**
   - Use HTTPS only
   - Implement rate limiting
   - Validate request origins (CORS)

## Project Structure

### Key Files and Directories
- `/frontend` - React application
- `/backend` - Express API server
- `ARCHITECTURE_V2.md` - System architecture documentation
- `AGENT.md` - AI agent documentation
- `BRAND_GUIDELINES.md` - Design system and brand guidelines
- `.github/` - GitHub templates and workflows

### Important Documentation
Before contributing, please read:
1. [ARCHITECTURE_V2.md](./ARCHITECTURE_V2.md) - Understand the system design
2. [AGENT.md](./AGENT.md) - Understand the AI integration
3. [BRAND_GUIDELINES.md](./BRAND_GUIDELINES.md) - Follow the design system

## Common Tasks

### Adding a New Interview Type
1. Update backend constants
2. Create new prompt template in agent
3. Update frontend selector
4. Add to documentation
5. Test thoroughly

### Modifying the AI Agent
1. Review AGENT.md for current behavior
2. Update prompt templates
3. Test with multiple transcript types
4. Document changes in AGENT.md

### UI/UX Changes
1. Follow BRAND_GUIDELINES.md
2. Test responsive design
3. Check accessibility
4. Get design review if significant

### Adding Dependencies
1. Consider bundle size impact
2. Check for security vulnerabilities
3. Document why the dependency is needed
4. Update relevant documentation

## Development Tips

### Debugging
- Use React DevTools for component debugging
- Check browser console for errors
- Monitor network tab for API calls
- Use Firebase console for database issues

### Performance
- Keep bundle size small
- Optimize images
- Use code splitting
- Monitor streaming performance

### Testing Locally
- Test with various transcript sizes
- Test with different interview types
- Test error scenarios
- Test slow network conditions

## Questions or Need Help?

- **Documentation**: Check README, ARCHITECTURE_V2.md, AGENT.md
- **Issues**: Search existing issues on GitHub
- **New Issues**: Create a new issue with details
- **Discussions**: Use GitHub Discussions for questions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be acknowledged in the project README. Thank you for helping make Interview Analyzer better!

---

Last Updated: November 2024
