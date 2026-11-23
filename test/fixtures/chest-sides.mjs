import { encodeLitematicFixture } from "./litematic-fixture.mjs";

export function createChestSidesFixture(kind, facing) {
  const paired = kind === "paired";
  const alongX = facing === "north" || facing === "south";
  const size = {
    x: paired && alongX ? 2 : 1,
    y: 1,
    z: paired && !alongX ? 2 : 1,
  };
  const types = paired
    ? facing === "north" || facing === "east"
      ? ["left", "right"]
      : ["right", "left"]
    : [kind];
  return {
    size,
    bytes: encodeLitematicFixture({
      name: `${facing} ${kind} chest`,
      regionName: "Chest sides",
      size,
      palette: [
        "air",
        ...types.map((type) => ({
          name: "chest",
          properties: { facing, type, waterlogged: "false" },
        })),
      ],
      blocks: types.map((_, index) => index + 1),
    }),
  };
}
