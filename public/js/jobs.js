async function refreshJobItem(item) {
  const id = item.dataset.jobId;
  if (!id) return;

  const statusNode = item.querySelector(".status");
  const resultNode = item.querySelector(".result");

  try {
    const response = await fetch(`/analysis/jobs/${id}`);
    if (!response.ok) return;
    const job = await response.json();

    statusNode.textContent = job.status;

    if (job.status === "completed") {
      resultNode.textContent = job.result || "(empty)";
      resultNode.classList.remove("error");
    } else if (job.status === "failed") {
      resultNode.textContent = job.error || "unknown error";
      resultNode.classList.add("error");
    } else {
      resultNode.textContent = "分析中...";
      resultNode.classList.remove("error");
    }
  } catch {
    // ignore transient errors
  }
}

async function tick() {
  const items = document.querySelectorAll(".job-item");
  await Promise.all([...items].map(refreshJobItem));
}

tick();
setInterval(tick, 4000);
