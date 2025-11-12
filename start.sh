#!/bin/bash

# PM Interview Analyzer - Start Script

echo "🎯 PM Interview Analyzer"
echo "========================"
echo ""

# Check if backend .env exists
if [ ! -f backend/.env ]; then
    echo "❌ Error: backend/.env file not found"
    echo "   Please create backend/.env with your ANTHROPIC_API_KEY"
    echo "   Copy from backend/.env.example and add your API key"
    echo ""
    exit 1
fi

# Check if API key is set
if ! grep -q "ANTHROPIC_API_KEY=sk-" backend/.env 2>/dev/null; then
    echo "⚠️  Warning: ANTHROPIC_API_KEY may not be set in backend/.env"
    echo "   Make sure it looks like: ANTHROPIC_API_KEY=sk-ant-..."
    echo ""
fi

echo "Starting services..."
echo ""

# Start backend in background
echo "🔧 Starting backend server..."
cd backend
npm run dev > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait a bit for backend to start
sleep 3

# Start frontend in background
echo "🎨 Starting frontend..."
cd frontend
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Services started!"
echo ""
echo "📡 Backend:  http://localhost:3001"
echo "🎨 Frontend: http://localhost:5173"
echo ""
echo "📋 Logs:"
echo "   Backend:  tail -f backend.log"
echo "   Frontend: tail -f frontend.log"
echo ""
echo "🛑 To stop both services:"
echo "   kill $BACKEND_PID $FRONTEND_PID"
echo ""
echo "   Or just run: pkill -f 'node.*tsx'"
echo ""
