# Use Node.js LTS
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# Create a non-root user to run the application
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port (Cloud Run will set PORT env var)
EXPOSE 3001

# Start the server
CMD ["npm", "start"]
