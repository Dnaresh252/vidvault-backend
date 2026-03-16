# Force rebuild - v20260316-008
FROM node:20-bullseye-slim

# Cache buster
ARG CACHEBUST=20260316-008
RUN echo "Build timestamp: $CACHEBUST"

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    ca-certificates \
    gcc \
    python3-dev \
    libssl-dev \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install latest yt-dlp binary directly from GitHub (BEST WAY!)
RUN echo "Installing latest yt-dlp binary at $(date)" && \
    wget -O /opt/venv/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && \
    chmod a+rx /opt/venv/bin/yt-dlp && \
    echo "Final version:" && \
    yt-dlp --version

RUN pip install --no-cache-dir curl-cffi
RUN pip install --no-cache-dir gallery-dl
RUN gallery-dl --version

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

RUN echo "Copying code at $(date)"
COPY . .

RUN mkdir -p /tmp/downloads /tmp/temp /tmp/ig-images && \
    chmod 777 /tmp/downloads /tmp/temp /tmp/ig-images

USER node

EXPOSE 5000

CMD ["node", "server.js"]
