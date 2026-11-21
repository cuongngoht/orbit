// What the execution worker asks of the Connections context's credential store: the API key of a connection whose
// method is `api_key`, read at the moment its model plane starts and handed to that process alone -- never to a tool
// plane, never logged, never kept. The Connections context binds it (infra/connections/credentials.ts).
export const CONNECTION_SECRETS = Symbol("CONNECTION_SECRETS");

export interface ConnectionSecrets {
  // The secret a reference names, or null (none written, or removed).
  read(ref: string | null): string | null;
}
