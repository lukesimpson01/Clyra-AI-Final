Vendored from [bloub](https://github.com/jeremy-prt/bloub) by Jérémy Perret, MIT licensed.

Only `math.ts`, `profiles.ts` and `shape.ts` are vendored here, copied verbatim -- the rest
of bloub's engine (state catalog, sphere-projected eyes, particles, orbit rings) isn't used.
`ClyraFace.tsx` (the sibling component that consumes `capsulePath` from `shape.ts`) is
Clyra's own code, hand-matched against the actual reference mockup's live DOM (a flat-color
"ball" div plus two capsule-path eyes) rather than bloub's own 14-state catalog.

MIT License

Copyright (c) 2026 Jérémy Perret

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
