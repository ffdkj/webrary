"""Test that the AI Reader LangGraph graph can be built when deps are present."""

import unittest

try:
    from app.routers.ai_reader import _build_graph
    _HAS_DEPS = True
except Exception:
    _HAS_DEPS = False


@unittest.skipUnless(_HAS_DEPS, "requires langgraph/langchain/openai dependencies")
class TestAIGraphBuild(unittest.TestCase):
    def test_build_graph(self):
        graph = _build_graph()
        self.assertIsNotNone(graph)


if __name__ == "__main__":
    unittest.main()