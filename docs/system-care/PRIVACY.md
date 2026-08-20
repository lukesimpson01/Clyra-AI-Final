# Privacy

Device observations are local. The Phase 1 service may collect hostname locally because it is part of the normalized profile, but `sanitizeDeviceContextForAI()` removes it before any AI context can be formed. Serial numbers, hardware UUIDs, MAC addresses, usernames, IP addresses, product keys and private paths are not collected by the Phase 1 provider.

AI context contains only device family/model, coarse OS/build, CPU capacity/load, memory aggregates, volume capacity and coarse battery facts. Web research must use publisher/product identifiers only and must never upload files or include local paths or filenames.

Scan history is currently in-memory UI state. Future persistence must remain local and store aggregate metrics or hashed identities rather than cloud file inventories.
