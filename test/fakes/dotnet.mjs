// The registry the composition root builds, for the tests that exercise the
// shipped .NET pack: the built-in ecosystem adapters, then the pack.
import { builtinEcosystems } from "../../src/ecosystems/builtin.mjs";
import { createIntelligenceRegistry } from "../../src/intelligence/registry.mjs";
import { registerDotnetPack } from "../../skills/orbit-dotnet/pack.mjs";

export const dotnetRegistry = () => registerDotnetPack(createIntelligenceRegistry({ ecosystems: builtinEcosystems() }));

export const project = (body, sdk = "Microsoft.NET.Sdk") => `<Project Sdk="${sdk}">\n${body}\n</Project>\n`;

export const references = (...names) => project(`  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n  <ItemGroup>\n${names.map((n) => `    <PackageReference Include="${n}" Version="1.0.0" />`).join("\n")}\n  </ItemGroup>`);
