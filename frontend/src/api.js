
import axios from "axios";

const api = axios.create({
  baseURL: "http://127.0.0.1:8000",
  headers: {
    "Content-Type": "application/json",
  },
});

export const getDashboardStats = async () => {
  const response = await api.get("/dashboard/stats");
  return response.data;
};

export const getJobs = async (params = {}) => {
  const response = await api.get("/jobs", { params });
  return response.data;
};

export const createJob = async (task_name) => {
  const response = await api.post("/jobs", {
    task_name: task_name,
  });
  return response.data;
};

export default api;
export const getHealth = async () => {
  const response = await api.get("/health");
  return response.data;
};
export const getThroughput = async (period = "last_60_minutes") => {
  const response = await api.get("/analytics/throughput", {
    params: { period },
  });

  return response.data;
};

export const getJob = async (jobId) => {
  const response = await api.get(`/jobs/${jobId}`);
  return response.data;
};