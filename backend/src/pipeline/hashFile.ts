import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Content hash of a file, used to identify identical video uploads regardless of filename/timestamp. */
export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
