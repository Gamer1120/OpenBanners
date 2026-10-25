import { generateReroute } from "./routeGenerator";
import { tk } from "../i18n";

self.onmessage = (event) => {
  const { type, draft, now, workerId, seedOffset } = event.data ?? {};

  if (type !== "generate") {
    return;
  }

  try {
    const route = generateReroute(draft, {
      now,
      seedOffset,
      logRejections: true,
      onProgress(progress) {
        self.postMessage({
          type: "progress",
          workerId,
          progress,
        });
      },
    });

    self.postMessage({
      type: "success",
      workerId,
      route,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      workerId,
      message:
        error instanceof Error
          ? error.message
          : tk("The reroute couldn't be generated."),
      i18n: error?.i18n ?? null,
    });
  }
};
