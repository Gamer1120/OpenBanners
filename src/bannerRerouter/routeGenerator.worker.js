import { generateReroute } from "./routeGenerator";

let activeChildWorkers = [];

function terminateChildWorkers() {
  activeChildWorkers.forEach((worker) => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  });
  activeChildWorkers = [];
}

function getParallelWorkerCount() {
  if (typeof Worker !== "function") {
    return 1;
  }

  const hardwareConcurrency = Number(self.navigator?.hardwareConcurrency);

  if (!Number.isFinite(hardwareConcurrency) || hardwareConcurrency <= 1) {
    return 1;
  }

  return Math.max(1, Math.floor(hardwareConcurrency));
}

function aggregateProgress(progressByWorkerId) {
  const progressEntries = Array.from(progressByWorkerId.values()).filter(Boolean);

  if (progressEntries.length === 0) {
    return null;
  }

  const hasFiniteTotal = progressEntries.every(
    (progress) =>
      Number.isFinite(progress?.totalCandidateCount) &&
      progress.totalCandidateCount >= 0
  );
  const totalCandidateCount = hasFiniteTotal
    ? progressEntries.reduce(
        (sum, progress) => sum + progress.totalCandidateCount,
        0
      )
    : null;
  const consideredCandidateCount = progressEntries.reduce(
    (sum, progress) => sum + (progress?.consideredCandidateCount ?? 0),
    0
  );
  const rejectedCandidateCount = progressEntries.reduce(
    (sum, progress) => sum + (progress?.rejectedCandidateCount ?? 0),
    0
  );
  const uniqueCandidateCount = progressEntries.reduce(
    (sum, progress) => sum + (progress?.uniqueCandidateCount ?? 0),
    0
  );
  const duplicateCandidateCount = progressEntries.reduce(
    (sum, progress) => sum + (progress?.duplicateCandidateCount ?? 0),
    0
  );

  return {
    consideredCandidateCount,
    totalCandidateCount,
    rejectedCandidateCount,
    uniqueCandidateCount,
    duplicateCandidateCount,
    progressRatio:
      Number.isFinite(totalCandidateCount) && totalCandidateCount > 0
        ? consideredCandidateCount / totalCandidateCount
        : null,
    searchPlanCount: progressEntries.reduce(
      (sum, progress) => sum + (progress?.searchPlanCount ?? 0),
      0
    ),
    restartCount: progressEntries.reduce(
      (sum, progress) => sum + (progress?.restartCount ?? 0),
      0
    ),
    attemptCount: progressEntries.reduce(
      (sum, progress) => sum + (progress?.attemptCount ?? 0),
      0
    ),
    isContinuingUniqueSearch: progressEntries.some(
      (progress) => progress?.isContinuingUniqueSearch
    ),
    uniqueSearchBatchCount: Math.max(
      ...progressEntries.map((progress) => progress?.uniqueSearchBatchCount ?? 0)
    ),
    shardCount: progressEntries.length,
  };
}

function runSingleThread(draft, now) {
  try {
    const route = generateReroute(draft, {
      now,
      logRejections: true,
      onProgress(progress) {
        self.postMessage({
          type: "progress",
          progress: {
            ...progress,
            shardCount: 1,
          },
        });
      },
    });

    self.postMessage({
      type: "success",
      route,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "The reroute couldn't be generated.",
    });
  }
}

function runParallel(draft, now, workerCount) {
  const progressByWorkerId = new Map();
  const errorMessages = new Map();
  let settled = false;
  let finishedWorkerCount = 0;

  const finishWithErrorIfNeeded = () => {
    if (settled || finishedWorkerCount < workerCount) {
      return;
    }

    settled = true;
    terminateChildWorkers();
    self.postMessage({
      type: "error",
      message:
        Array.from(errorMessages.values()).find(
          (message) => typeof message === "string" && message.trim()
        ) ?? "The reroute couldn't be generated.",
    });
  };

  for (let workerId = 0; workerId < workerCount; workerId += 1) {
    const childWorker = new Worker(
      new URL("./routeGenerator.search.worker.js", import.meta.url),
      { type: "module" }
    );
    activeChildWorkers.push(childWorker);

    childWorker.onmessage = (event) => {
      if (settled) {
        return;
      }

      const message = event.data ?? {};

      if (message.type === "progress") {
        progressByWorkerId.set(workerId, message.progress ?? null);
        const aggregatedProgress = aggregateProgress(progressByWorkerId);

        if (aggregatedProgress) {
          self.postMessage({
            type: "progress",
            progress: aggregatedProgress,
          });
        }
        return;
      }

      if (message.type === "success") {
        settled = true;
        terminateChildWorkers();
        self.postMessage({
          type: "success",
          route: message.route,
        });
        return;
      }

      finishedWorkerCount += 1;
      errorMessages.set(workerId, message.message);
      finishWithErrorIfNeeded();
    };

    childWorker.onerror = () => {
      if (settled) {
        return;
      }

      finishedWorkerCount += 1;
      errorMessages.set(
        workerId,
        "A parallel reroute worker failed before it could finish."
      );
      finishWithErrorIfNeeded();
    };

    childWorker.postMessage({
      type: "generate",
      workerId,
      draft,
      now,
      seedOffset: ((workerId + 1) * 0x9e3779b9) >>> 0,
    });
  }
}

self.onmessage = (event) => {
  const { type, draft, now } = event.data ?? {};

  if (type !== "generate") {
    return;
  }

  terminateChildWorkers();

  const workerCount = getParallelWorkerCount();

  if (workerCount <= 1) {
    runSingleThread(draft, now);
    return;
  }

  try {
    runParallel(draft, now, workerCount);
  } catch (error) {
    terminateChildWorkers();
    runSingleThread(draft, now);
  }
};
