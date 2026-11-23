# Minecraft texture assets

The PNG artwork encoded in `26.3.json`, the generated `assets/litematic-atlas.png`, and the
image encoded in `renderer/generated/atlas-image.mjs` originate from Minecraft
Java Edition 26.3. Copyright belongs to Mojang AB and Microsoft. These assets
are **not** licensed under this repository's MIT code license.

The official source manifest, client archive SHA-1, release version, and scope
of extraction are recorded in `source.json`. Block textures and selected entity
texture PNG files, with their animation metadata, and the end-sky texture were
extracted. The selected
entity sheets cover chests, banners and patterns, shulker boxes, decorated pots,
bells, conduits, built-in head textures, the enchanting-table book and the
end-portal surface. Beds and signs already use the
26.3 block sheets. The client archive, game code, and external player skins are
not included in the distributed repository.

The source container stores each original file's bytes as base64 under its
relative filename; entity and environment sheets have `entity/` and
`environment/` prefixes to preserve distinct
texture names. The complete source-byte hash is recorded in `source.json` and
checked during builds. Packing the sources into one file keeps the theme below
Discourse's repository file-count limit and supports offline atlas rebuilding.

Related official terms:

- [Minecraft EULA](https://www.minecraft.net/en-us/eula)
- [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)

The atlas build script is original project code and remains covered by the
project's MIT license. The generated atlas preserves the native pixel dimensions
of each texture or its first displayed animation frame. Texture content and code
retain their separate ownership and terms.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR
MICROSOFT.
