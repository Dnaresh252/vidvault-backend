# Force rebuild - Python 3.9 compatible
FROM node:20-slim
ARG CACHEBUST=20260517-nosleep

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
    aria2 \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:/usr/local/bin:$PATH"

# Install Python packages
RUN echo "Installing yt-dlp - Build: $CACHEBUST" && \
    pip install --no-cache-dir -U --pre "yt-dlp[default]" && \
    yt-dlp --version

RUN pip install --no-cache-dir curl-cffi
RUN pip install --no-cache-dir yt-dlp-ejs
RUN pip install --no-cache-dir bgutil-ytdlp-pot-provider
RUN pip install --no-cache-dir gallery-dl
RUN gallery-dl --version

RUN echo "--js-runtimes node:/usr/local/bin/node" > /etc/yt-dlp.conf
# Verify node is accessible
RUN node --version && yt-dlp --version
ARG CACHEBUST=20260506-sleep-fix
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Force fresh code copy
RUN echo "Code copy timestamp: $(date)"
COPY . .

RUN mkdir -p /tmp/downloads /tmp/temp /tmp/ig-images /tmp/cookies && \
    chmod 777 /tmp/downloads /tmp/temp /tmp/ig-images /tmp/cookies

COPY cookies/youtube_cookies.txt /tmp/cookies/youtube_cookies.txt
COPY cookies/youtube_cookies_2.txt /tmp/cookies/youtube_cookies_2.txt
COPY cookies/instagram_cookies.txt /tmp/cookies/instagram_cookies.txt
COPY cookies/instagram_cookies_1.txt /tmp/cookies/instagram_cookies_1.txt
COPY cookies/instagram_cookies_2.txt /tmp/cookies/instagram_cookies_2.txt
RUN chmod 666 /tmp/cookies/youtube_cookies.txt && \
    chmod 666 /tmp/cookies/youtube_cookies_2.txt && \
    chmod 666 /tmp/cookies/instagram_cookies.txt && \
    chmod 666 /tmp/cookies/instagram_cookies_1.txt && \
    chmod 666 /tmp/cookies/instagram_cookies_2.txt

USER node

EXPOSE 5000

CMD ["node", "server.js"]