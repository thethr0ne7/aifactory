# Local AI Runtime

## Purpose

Use local models/runtimes when privacy, offline operation, predictable cost or low-latency local processing materially benefits the task.

## Activate when

A workload can be handled locally and remote-provider dependence is undesirable or unnecessary.

## Workflow

1. Define capability requirements: model size, context, modality, latency and quality threshold.
2. Check available hardware and memory budget.
3. Choose a local runtime/model only if it can meet the benchmark.
4. Keep provider/model behind a replaceable adapter.
5. Benchmark against the current remote/default path on representative tasks.
6. Route high-stakes or unsupported tasks to a stronger verified path.

## Guardrails

- Local is not automatically more private if tools/logs leak data elsewhere.
- Do not force local execution when hardware makes quality/usability unacceptable.
- Model files and licenses require provenance.
- Local runtime is an amplifier/fallback, not mandatory infrastructure.
