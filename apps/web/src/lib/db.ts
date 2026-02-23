import { getClient } from "@botwallet/db";

// Re-export the singleton client
export const getDb = getClient;
