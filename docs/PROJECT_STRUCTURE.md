# Project Structure

PyDroid Node keeps public contracts separate from host implementation.

```text
PyDroid Node/
├─ sdk/                    # public plugin/theme/design SDK
├─ src/
│  ├─ plugins/             # plugin host, archive loader and manager UI
│  ├─ nodes/               # node layout and declarative node UI
│  ├─ styles/              # global UI/theme/canvas style layers
│  ├─ editor-core/         # editor ownership and commands
│  ├─ workflow-core/       # workflow model, persistence and migration
│  ├─ runtime/             # JavaScript/Python runtime bridge
│  ├─ mcp/                 # MCP Core adapter/host
│  └─ platform/            # platform boundary
├─ desktop/                # Electron host
├─ android/                # Android host
├─ python/                 # Python runtime
├─ examples/               # executable workflows and plugin fixtures
├─ scripts/                # regression/build tooling
├─ tests/                  # parity fixtures and integration tests
└─ docs/                   # architecture and handoff documentation
```

## Ownership rules

- `sdk/` is the only public plugin-development surface.
- `src/plugins/` owns installation, activation, persistence and archive parsing.
- `src/nodes/` owns node geometry/declarative node UI; themes cannot override geometry.
- `src/styles/` owns shared application visual layers. Plugin UI consumes the same semantic tokens.
- Example plugins are regression/reference fixtures and are not Core implementation.
