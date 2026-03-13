const mongoose = require("mongoose");

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    console.log("✅ MongoDB already connected");
    return;
  }

  try {
    mongoose.set("strictQuery", true);

    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 5, // ✅ IMPORTANT for M0 free tier
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      compressors: "snappy,zlib", // ✅ NEW: Compress network traffic!
      zlibCompressionLevel: 6, // ✅ NEW: Balance speed vs compression
    });

    isConnected = true;

    console.log("✅ MongoDB Atlas Connected Successfully");
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(`🔗 Host: ${mongoose.connection.host}`);
    console.log(`🗜️ Compression: snappy,zlib enabled`); // ✅ NEW: Confirm compression
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);

    // ✅ stop retry spam (Railway will restart)
    process.exit(1);
  }
};

// ✅ Only log events (NO reconnect loop)
mongoose.connection.on("disconnected", () => {
  isConnected = false;
  console.log("⚠️ MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  console.log("❌ MongoDB error:", err.message);
});

module.exports = connectDB;
