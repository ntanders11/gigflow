import { describe, it, expect } from "vitest";
import { mapFoursquarePlace, looseNameKey } from "./foursquare";

const none = new Set<string>();
const place = (name: string, cat: string, extra = {}) => ({
  fsq_place_id: "1", name, categories: [{ name: cat }], tel: "555-1212", location: { locality: "Newberg", formatted_address: "1 Main St" }, ...extra,
});

describe("mapFoursquarePlace", () => {
  it("keeps bars and maps wineries and breweries to our types", () => {
    expect(mapFoursquarePlace(place("McKenzie Pub", "Pub"), none)?.type).toBe("bar");
    expect(mapFoursquarePlace(place("Bergstrom", "Wine Bar"), none)?.type).toBe("winery");
    expect(mapFoursquarePlace(place("Dobbes", "Winery"), none)?.type).toBe("winery");
    expect(mapFoursquarePlace(place("Hop Yard", "Brewery"), none)?.type).toBe("brewery");
  });
  it("drops restaurants, chains, libraries and shops", () => {
    expect(mapFoursquarePlace(place("Taco Bell", "Fast Food Restaurant"), none)).toBeNull();
    expect(mapFoursquarePlace(place("Library", "Library"), none)).toBeNull();
    expect(mapFoursquarePlace(place("Wine Shop", "Wine Store"), none)).toBeNull();
  });
  it("drops places with no phone and no website", () => {
    expect(mapFoursquarePlace(place("Ghost Bar", "Bar", { tel: undefined }), none)).toBeNull();
    expect(mapFoursquarePlace(place("Web Bar", "Bar", { tel: undefined, website: "https://x.com" }), none)?.website).toBe("https://x.com");
  });
  it("flags places already in the artist's pipeline", () => {
    expect(mapFoursquarePlace(place("Old Oak", "Bar"), new Set(["old oak"]))?.already_in_pipeline).toBe(true);
  });
  it("has no live-music badge", () => {
    expect(mapFoursquarePlace(place("Old Oak", "Bar"), none)?.live_music_tagged).toBe(false);
  });
});

describe("looseNameKey", () => {
  it("collapses near-duplicate names", () => {
    expect(looseNameKey("The Roof Top Bar")).toBe(looseNameKey("Rooftop"));
    expect(looseNameKey("Dillons Bar & Grill")).toBe(looseNameKey("Dillon's"));
  });
});
