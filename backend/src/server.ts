import express from "express";
import path from "node:path";
import fs from "node:fs";
import { uploadRouter } from "./routes/upload.js";
import { jobsRouter } from "./routes/jobs.js";
import { PROCESSED_DIR } from "./pipeline/paths.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

const FRONTEND_DIST = path.resolve("../frontend/dist");

app.use(express.json());
app.use("/api", (req, res, next) => {
  const origin = req.get("origin");
  if (origin && origin !== `http://${req.get("host")}`) {
    res.sendStatus(403);
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(uploadRouter);
app.use(jobsRouter);
app.use("/media", express.static(PROCESSED_DIR));

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`FollowEnglish backend listening on http://localhost:${PORT}`);
});
