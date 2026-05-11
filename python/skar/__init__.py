"""Skar runtime — capture tool-using agent runs and emit Skar trace JSON.

See https://github.com/kalisky/skar for the broader project (CLI + MCP server
+ trace schema). This package is the Python-side runtime: a small helper
for instrumenting your agent code to produce traces that `skar generate`
can convert into pytest regression tests.

Usage:

    from skar import Recorder

    recorder = Recorder()
    result = my_agent.run(
        prompt=prompt,
        tool_executor=recorder.wrap(my_real_tool_executor),
    )
    recorder.write(
        "traces/my_run.json",
        prompt=prompt,
        status="unknown",
        output_text=result.get("output_text"),
    )
"""

from skar.recorder import Recorder, SchemaError

__all__ = ["Recorder", "SchemaError", "__version__"]
__version__ = "0.2.0"
