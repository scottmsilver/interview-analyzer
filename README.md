# Interview Analyzer

An AI-powered platform for analyzing interview transcripts using Claude. Get detailed, constructive feedback to improve your interview performance.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![React](https://img.shields.io/badge/react-18.x-61dafb.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-3178c6.svg)

## Features

- **AI-Powered Analysis**: Leverages Claude for comprehensive interview feedback
- **Multiple Interview Types**: Built-in types plus admin-defined custom interview types
- **Real-Time Streaming**: See analysis results as they're generated
- **System-Agent Dialogue**: Visual indicator of AI thinking process
- **Secure Authentication**: Firebase Auth with Google Sign-In
- **Interview History**: Save and review past analyses
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile
- **Professional UI**: Clean, modern interface following brand guidelines

## Quick Start

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Firebase account
- Anthropic API key

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/scottmsilver/interview-analyzer.git
   cd interview-analyzer
   ```

2. **Install dependencies**
   ```bash
   # Frontend
   cd frontend
   npm install

   # Backend
   cd ../backend
   npm install
   ```

3. **Configure environment variables**

   Create `frontend/.env`:
   ```env
   VITE_API_URL=http://localhost:9002
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   ```

   Create `backend/.env`:
   ```env
   ANTHROPIC_API_KEY=your_anthropic_api_key
   PORT=9002
   ```

4. **Run development servers**
   ```bash
   # Frontend (from frontend directory)
   npm run dev

   # Backend (from backend directory)
   npm run dev
   ```

5. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:9002

## Usage

1. **Sign In**: Click "Sign in with Google" to authenticate
2. **Upload Transcript**: Drop a file or paste your interview transcript
3. **Select Interview Type**: Choose the appropriate interview type
4. **Analyze**: Watch as the AI analyzes your interview in real-time
5. **Review Feedback**: Get detailed strengths, improvements, and recommendations
6. **View History**: Access your saved analyses anytime

## Architecture

Interview Analyzer uses a modern, cloud-native architecture:

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Node.js + Express
- **AI**: Anthropic Claude
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **Deployment**: Fly.io (frontend + backend)

## Documentation

- **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Detailed setup instructions
- **[FIREBASE_SETUP.md](./FIREBASE_SETUP.md)** - Firebase configuration guide
- **[BRAND_GUIDELINES.md](./BRAND_GUIDELINES.md)** - Design system and UI guidelines

## Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend Framework | React 18 + TypeScript |
| Build Tool | Vite |
| Backend | Node.js + Express |
| AI Model | Anthropic Claude |
| Database | Firebase Firestore |
| Authentication | Firebase Auth |
| Styling | CSS Modules |
| Routing | React Router v6 |
| Deployment | Fly.io |

## Key Features

### AI-Powered Analysis
- Streaming analysis results for real-time feedback
- Interview type-specific evaluation criteria
- Structured feedback with actionable recommendations
- Example improvements with before/after comparisons

### User Experience
- Clean, professional interface
- System-agent dialogue visualization
- Mobile-responsive design
- Auto-save functionality
- Shareable analysis links

### Security
- Firebase Authentication
- Secure API key management
- Input validation and sanitization
- HTTPS-only communication
- User data isolation

## Development

### Project Structure
```
interview-analyzer/
├── frontend/               # React frontend
│   ├── src/
│   │   ├── App.tsx        # Main application
│   │   ├── api.ts         # Firebase and API services
│   │   ├── components.tsx # Shared components
│   │   └── types.ts       # TypeScript types
│   └── package.json
├── backend/               # Express backend
│   ├── src/
│   │   ├── analyzer.ts    # Analysis engine
│   │   ├── server.ts      # Express server
│   │   └── criteria-cache.ts # Criteria management
│   └── package.json
├── .github/              # GitHub templates and workflows
├── SETUP_GUIDE.md        # Setup instructions
├── FIREBASE_SETUP.md     # Firebase configuration
└── BRAND_GUIDELINES.md   # Design system
```

### Building for Production

```bash
# Frontend
cd frontend
npm run build

# Backend
cd backend
npm run build
```

### Deployment

**Backend (Fly.io)**
```bash
cd backend
fly deploy
```

**Frontend (Fly.io)**
```bash
cd frontend
fly deploy
```

**Firebase (Firestore rules and indexes)**
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Quick Contribution Guide
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

## Security

### Reporting Vulnerabilities
Please email security issues privately to the maintainers. Do not create public issues for security vulnerabilities.

### Best Practices
- Never commit API keys or credentials
- Use environment variables for configuration
- Follow security guidelines in CONTRIBUTING.md
- Keep dependencies updated

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Support

- **Issues**: Report bugs or request features via [GitHub Issues](https://github.com/scottmsilver/interview-analyzer/issues)
- **Documentation**: Check the docs in this repository
- **Questions**: Use [GitHub Discussions](https://github.com/scottmsilver/interview-analyzer/discussions)

## Roadmap

- [ ] Multi-language support
- [ ] Voice transcript processing
- [ ] Comparative analysis across interviews
- [x] Custom evaluation criteria
- [ ] Video analysis integration
- [ ] Mock interview practice mode

## Acknowledgments

- Built with [Anthropic Claude](https://www.anthropic.com/)
- Powered by [Firebase](https://firebase.google.com/)
- UI framework: [React](https://react.dev/)

---

**Made with care for people preparing for interviews**

Last Updated: March 2026
