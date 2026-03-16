# Force rebuild - v20260316-003
FROM node:20-bullseye-slim

# Cache buster - change this to force rebuild
ARG CACHEBUST=20260316-003
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
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Force fresh yt-dlp install
RUN echo "Installing yt-dlp at $(date)" && \
    pip install --no-cache-dir -U --pre "yt-dlp[default]" && \
    yt-dlp --version

RUN pip install --no-cache-dir curl-cffi
RUN pip install --no-cache-dir gallery-dl
RUN gallery-dl --version

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Force fresh code copy
RUN echo "Copying code at $(date)"
COPY . .

RUN mkdir -p /tmp/downloads /tmp/temp /tmp/ig-images && \
    chmod 777 /tmp/downloads /tmp/temp /tmp/ig-images

USER node

EXPOSE 5000

CMD ["node", "server.js"]