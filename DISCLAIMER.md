# Disclaimer

KiroGraph is provided for informational and development purposes only. While every effort is made to ensure the software functions correctly, the authors make no representations or warranties regarding the accuracy, completeness, or reliability of the results produced by the software.

## Limitations of Use

- KiroGraph is a development tool intended to assist with code exploration and analysis. It is not a substitute for professional code review, security auditing, or testing.
- The "dead code detection", "impact analysis", and "circular dependency" features are heuristic-based and may produce false positives or miss certain cases. Always verify results independently.
- Token savings estimates reported by `kirograph_gain` are approximations based on heuristics and should not be treated as exact measurements.
- The software indexes and processes source code locally. Users are responsible for ensuring they have the right to index and analyze the code in their projects.

## No Professional Advice

Nothing produced by KiroGraph constitutes professional advice of any kind (legal, security, architectural, or otherwise). Users should consult qualified professionals for decisions that require expert judgment.

## Third-Party Dependencies

KiroGraph relies on third-party libraries and tools (tree-sitter, embedding models, semantic engines). The authors of KiroGraph are not responsible for the behavior, accuracy, or availability of these dependencies.

## Data Handling

All data processed by KiroGraph remains local to your machine. However, users are responsible for:
- Ensuring sensitive code or data is not inadvertently exposed through exported dashboards or shared snapshots.
- Managing access to the `.kirograph/` directory, which contains indexed representations of your source code.
