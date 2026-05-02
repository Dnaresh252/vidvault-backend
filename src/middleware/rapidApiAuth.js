function rapidApiAuth(req, res, next) {
  const proxySecret = req.headers["x-rapidapi-proxy-secret"];
  const validSecret = process.env.RAPIDAPI_PROXY_SECRET;

  if (!proxySecret || proxySecret !== validSecret) {
    return res.status(401).json({
      message: "Invalid API key. Get your key at rapidapi.com",
    });
  }
  next();
}

module.exports = rapidApiAuth;
