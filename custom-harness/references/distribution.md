# Distribution

## Source layout

Maintain one language-neutral core containing templates, schemas, policy semantics, and conformance fixtures. Generate platform adapters from that core. Build wrappers from the same source revision and embed a manifest containing `coreVersion`, wrapper version, and a core content hash.

## JavaScript ecosystems

Publish one npm package, for example `@scope/custom-harness`, with a `package.json` `bin` entry exposing `custom-harness`. The same package is consumed through:

```text
npx @scope/custom-harness
npm exec --package=@scope/custom-harness custom-harness
pnpm dlx @scope/custom-harness
bunx @scope/custom-harness
```

Do not create separate pnpm or Bun packages. Keep the CLI a thin wrapper over the embedded core and support `install`, `validate`, `--platform`, `--target`, `--dry-run`, and an explicit replacement flag.

## .NET ecosystem

Publish a separate NuGet package as a .NET tool with `PackAsTool=true` and a command such as `custom-harness`. The tool explicitly performs preview/install/validate operations. Do not rely on `contentFiles` or install-time mutation as the primary mechanism because package restore should not silently rewrite a consumer repository.

The NuGet tool embeds or consumes the same generated core artifact as the npm wrapper; it does not shell out to npm and npm does not depend on .NET.

## Versioning and release gates

- Use synchronized SemVer for core, npm wrapper, and NuGet wrapper when released together.
- Fail builds if embedded core hashes or adapter conformance snapshots differ.
- Test npm CLI execution under Node plus smoke tests through npm exec/npx, pnpm dlx, and bunx.
- Test the packed `.nupkg` using `dotnet tool install --tool-path` in an isolated directory.
- Publish only after both packages pass identical golden install/validate cases.
- Release npm and NuGet independently as artifacts but from one signed/tagged source revision; document partial-release recovery without changing version meaning.
