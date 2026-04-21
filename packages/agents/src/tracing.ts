import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

/**
 * OpenTelemetry + Langfuse wiring for @bluecairn/agents (ADR-0005, ADR-0010).
 *
 * Instantiates a NodeTracerProvider with a LangfuseSpanProcessor so every
 * span emitted by the Vercel AI SDK's `experimental_telemetry` flow (and
 * any explicit `startActiveObservation` call) is batched and shipped to
 * Langfuse Cloud.
 *
 * Call `initTracing` once per process boot — apps/workers + any smoke
 * script that exercises the LLM wrapper. Idempotent; repeated calls are
 * no-ops. We use `NodeTracerProvider` directly rather than the heavier
 * `NodeSDK` wrapper to keep the OpenTelemetry version surface small and
 * aligned with @langfuse/otel's peer requirements.
 */

export interface TracingConfig {
  publicKey: string
  secretKey: string
  host: string
  environment: string
  exportMode?: 'batched' | 'immediate'
}

let provider: NodeTracerProvider | undefined

export const initTracing = (config: TracingConfig): void => {
  if (provider !== undefined) return
  provider = new NodeTracerProvider({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: config.publicKey,
        secretKey: config.secretKey,
        baseUrl: config.host,
        environment: config.environment,
        exportMode: config.exportMode ?? 'batched',
      }),
    ],
  })
  provider.register()
}

export const shutdownTracing = async (): Promise<void> => {
  if (provider === undefined) return
  await provider.shutdown()
  provider = undefined
}
