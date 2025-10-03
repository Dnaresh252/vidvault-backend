const mongoose = require("mongoose");

const connectDB = async () => {
  const maxRetries = 5;
  let retryCount = 0;

  const attemptConnection = async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        maxPoolSize: 10,
        minPoolSize: 2,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 10000,
        family: 4,
      });

      console.log("✅ MongoDB Atlas Connected Successfully");
      console.log(`📊 Database: ${mongoose.connection.name}`);
      console.log(`🔗 Host: ${mongoose.connection.host}`);

      retryCount = 0;
    } catch (error) {
      retryCount++;
      console.error(
        `❌ MongoDB Connection Error (Attempt ${retryCount}/${maxRetries}):`,
        error.message
      );

      if (retryCount < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, retryCount), 30000);
        console.log(`⏳ Retrying in ${waitTime / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return attemptConnection();
      } else {
        console.error("❌ MongoDB connection failed after maximum retries");
        if (process.env.NODE_ENV === "production") {
          process.exit(1);
        }
      }
    }
  };

  await attemptConnection();
};

mongoose.connection.on("disconnected", async () => {
  console.log("⚠️ MongoDB Disconnected - Attempting to reconnect...");
  await connectDB();
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB Error:", err.message);
  if (
    err.message.includes("ECONNREFUSED") ||
    err.message.includes("MongoNetworkError")
  ) {
    console.log("🔄 Connection lost, will attempt to reconnect...");
  }
});

mongoose.connection.on("reconnected", () => {
  console.log("✅ MongoDB Reconnected Successfully");
});

module.exports = connectDB;
