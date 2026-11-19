import { Admin } from "@platformatic/kafka";

export async function ensureTopics(brokers: string[], topics: { name: string; partitions: number }[]): Promise<string[]> {
  const admin = new Admin({ clientId: "arth-topic-bootstrap", bootstrapBrokers: brokers, retries: 30, retryDelay: 1_000 });
  try {
    const existing = new Set(await admin.listTopics());
    const missing = topics.filter((t) => !existing.has(t.name));
    for (const t of missing) {
      await admin.createTopics({ topics: [t.name], partitions: t.partitions, replicas: 1 });
    }
    return missing.map((t) => t.name);
  } finally {
    await admin.close();
  }
}
