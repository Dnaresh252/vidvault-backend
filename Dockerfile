FROM node:20-slim

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

RUN pip install --no-cache-dir -U --pre "yt-dlp[default]"
RUN pip install --no-cache-dir curl-cffi
RUN pip install --no-cache-dir gallery-dl
RUN yt-dlp --version
RUN gallery-dl --version

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p /tmp/downloads /tmp/temp /tmp/ig-images && \
    chmod 777 /tmp/downloads /tmp/temp /tmp/ig-images

USER node

EXPOSE 5000

CMD ["node", "server.js"]