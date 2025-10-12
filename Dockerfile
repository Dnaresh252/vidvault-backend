# Use Node 20 slim as base
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally (Python package)
RUN pip3 install --break-system-packages --no-cache-dir yt-dlp

# Create app directory
WORKDIR /app

# Copy package files first and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the app
COPY . .

# Expose the port your app will run on
EXPOSE 5000

# Use a non-root user for security
RUN useradd -m appuser
USER appuser

# Start the server
CMD ["node", "server.js"]
