FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install LATEST yt-dlp (CRITICAL FIX)
RUN pip3 install --break-system-packages --no-cache-dir -U yt-dlp

# Update yt-dlp to latest nightly build (EXTRA PROTECTION)
RUN pip3 install --break-system-packages --no-cache-dir -U --pre yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 5000

RUN useradd -m appuser
USER appuser

CMD ["node", "server.js"]