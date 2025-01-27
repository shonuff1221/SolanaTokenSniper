# Use Node.js 18 as base image
FROM node:18-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Set environment variables
ENV NODE_ENV=production

# Expose the webhook port
EXPOSE 3000

# Start the webhook receiver
CMD ["npm", "run", "start:webhook"]
