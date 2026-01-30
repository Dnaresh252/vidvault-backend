FROM node:20-slim

# System deps
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp (initial)
RUN pip install --no-cache-dir -U yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Temp dirs (Railway-safe)
RUN mkdir -p /tmp/downloads /tmp/temp && \
    chmod 777 /tmp/downloads /tmp/temp

EXPOSE 5000

# ✅ AUTO-UPDATE yt-dlp AT RUNTIME (ONE LINE MAGIC)
CMD sh -c "yt-dlp -U || true && node server.js"
