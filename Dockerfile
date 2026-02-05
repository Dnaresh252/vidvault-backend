FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# ✅ Install yt-dlp with pre-release fixes
RUN pip install --no-cache-dir -U --pre "yt-dlp[default]"
RUN yt-dlp --version

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p /tmp/downloads /tmp/temp && \
    chmod 777 /tmp/downloads /tmp/temp

USER node

EXPOSE 5000

CMD ["node", "server.js"]
