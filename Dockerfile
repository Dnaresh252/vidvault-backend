FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create and use virtual environment for Python packages
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install yt-dlp in virtual environment (CRITICAL - Latest version)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --upgrade yt-dlp

# Verify yt-dlp installation
RUN yt-dlp --version

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Create necessary directories with proper permissions
RUN mkdir -p /tmp/downloads /tmp/temp && \
    chmod 777 /tmp/downloads /tmp/temp

EXPOSE 5000

# Don't run as root
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app /tmp/downloads /tmp/temp

USER appuser

CMD ["node", "server.js"]