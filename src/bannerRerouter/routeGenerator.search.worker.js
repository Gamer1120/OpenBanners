import { generateReroute } from "./routeGenerator";

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
          : "The reroute couldn't be generated.",
    });
  }
};
