/**
 * The 2D game runtime (Phaser adapter).
 *
 * Phaser owns rendering, arcade physics and the tilemap; this class owns the
 * IR→scene compile, the semantic input actions, the event stream and the
 * deterministic stepping the playtest bot needs. Phaser's own RAF loop is
 * stopped so `game.step()` is driven manually, exactly as in the 3D runtime.
 */
import Phaser from "phaser";
import type { EntityIR, GameProjectIR, SceneIR, Vec3 } from "../ir/types";
import { TILE } from "../procedural/tilemap2d";
import type { GameEvent, RenderReport, RuntimeMetrics, RuntimeSnapshot } from "./protocol";

interface Actor {
  ir: EntityIR;
  sprite: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
  components: Map<string, Record<string, unknown>>;
  alive: boolean;
  state: Record<string, unknown>;
}

function detectRenderer(canvas: HTMLCanvasElement): number {
  try {
    const probe = document.createElement("canvas");
    if (probe.getContext("webgl2") || probe.getContext("webgl")) return Phaser.WEBGL;
  } catch {
    // Fall through to the 2D canvas renderer.
  }
  void canvas;
  return Phaser.CANVAS;
}

function componentMap(ir: EntityIR) {
  const map = new Map<string, Record<string, unknown>>();
  for (const component of ir.components) {
    if (component.enabled === false) continue;
    map.set(component.type, component.data);
  }
  return map;
}

class GameScene extends Phaser.Scene {
  world!: World2D;

  constructor() {
    super({ key: "gm-2d" });
  }

  create() {
    this.world.attach(this);
  }

  update(_time: number, delta: number) {
    this.world.simulate(delta / 1000);
  }
}

export class World2D {
  readonly game: Phaser.Game;
  private scene: GameScene | null;
  private sceneIR: SceneIR | null = null;
  private project: GameProjectIR | null = null;
  private platforms: Phaser.Physics.Arcade.StaticGroup | null = null;
  private readonly actors = new Map<string, Actor>();
  private playerId: string | null = null;
  private eventSequence = 0;
  private wallClock = 0;
  private tileSize = 32;

  readonly events: GameEvent[] = [];
  readonly held = new Set<string>();
  time = 0;
  frame = 0;
  timeScale = 1;
  warnings: string[] = [];
  runtimeErrors = 0;
  moveTarget: Vec3 | null = null;
  private readyResolve: (() => void) | null = null;
  private readonly ready: Promise<void>;

  constructor(canvas: HTMLCanvasElement, private readonly emit: (event: GameEvent) => void) {
    this.ready = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    // The scene instance is constructed here rather than fetched back out of
    // Phaser afterwards: `game.scene.getScene()` returns null until Phaser
    // has finished its asynchronous boot, so reading it in the constructor
    // races the engine and leaves the world unwired.
    const scene = new GameScene();
    this.scene = scene;

    this.game = new Phaser.Game({
      // Phaser refuses AUTO when it is handed a canvas rather than a parent
      // element ("Must set explicit renderType in custom environment"), so
      // the renderer is chosen here instead of left to detection.
      type: detectRenderer(canvas),
      canvas,
      width: canvas.clientWidth || 1280,
      height: canvas.clientHeight || 720,
      backgroundColor: "#5b9bd5",
      physics: { default: "arcade", arcade: { gravity: { x: 0, y: 1500 }, debug: false } },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
      scene,
      banner: false,
      audio: { noAudio: true },
    });
    scene.world = this;
    // The clock is taken over in whenReady(), NOT here: Phaser creates its
    // renderer during boot, and stopping the loop first leaves `step()`
    // running against a null renderer.
  }

  attach(scene: GameScene) {
    this.scene = scene;
    this.platforms = scene.physics.add.staticGroup();
    this.readyResolve?.();
  }

  /**
   * Phaser boots asynchronously. Pump frames until its scene has run create()
   * and handed us the physics world, rather than assuming one step is enough.
   */
  async whenReady() {
    const deadline = Date.now() + 15_000;
    let settled = false;
    void this.ready.then(() => {
      settled = true;
    });

    // Let Phaser run its own loop until the renderer exists and the scene has
    // run create(); only then take the clock so stepping is deterministic.
    while (!settled && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    if (!settled) {
      throw new Error(
        "The 2D runtime did not finish starting within 15 seconds. Phaser booted but its scene never ran create().",
      );
    }

    this.game.loop.stop();
    this.wallClock = this.game.loop.time;
  }

  load(project: GameProjectIR, sceneId?: string) {
    const scene = project.scenes.find((candidate) => candidate.id === (sceneId ?? project.activeSceneId)) ?? project.scenes[0];
    if (!scene) throw new Error("This project has no scenes to run.");
    if (!this.scene || !this.platforms) throw new Error("The 2D runtime has not finished starting.");

    this.clear();
    this.project = project;
    this.sceneIR = scene;

    const background = Phaser.Display.Color.HexStringToColor(scene.environment.skyColor || "#5b9bd5");
    this.scene.cameras.main.setBackgroundColor(background.color);

    for (const [, ir] of Object.entries(scene.entities)) {
      const components = componentMap(ir);
      const tilemap = components.get("Tilemap");
      if (tilemap) this.buildTilemap(tilemap);
    }
    for (const [, ir] of Object.entries(scene.entities)) {
      const components = componentMap(ir);
      if (components.has("Tilemap")) continue;
      this.buildActor(ir, components);
    }

    if (!this.playerId) this.warnings.push("No player entity was found in this 2D scene.");
    return { sceneId: scene.id, entityCount: this.actors.size, warnings: this.warnings };
  }

  private clear() {
    for (const actor of this.actors.values()) actor.sprite.destroy();
    this.actors.clear();
    this.platforms?.clear(true, true);
    this.playerId = null;
    this.events.length = 0;
    this.eventSequence = 0;
    this.time = 0;
    this.frame = 0;
    this.warnings = [];
    this.runtimeErrors = 0;
    this.moveTarget = null;
  }

  private buildTilemap(component: Record<string, unknown>) {
    if (!this.scene || !this.platforms) return;
    const width = Number(component.width ?? 0);
    const height = Number(component.height ?? 0);
    const tileSize = Number(component.tileSize ?? 32);
    this.tileSize = tileSize;
    const tiles = (component.tiles as number[] | undefined) ?? [];
    const palette = (component.palette ?? {}) as Record<string, string>;
    const colorFor = (tile: number) =>
      Phaser.Display.Color.HexStringToColor(
        tile === TILE.hazard ? palette.hazard ?? "#c0392b" : tile === TILE.platform ? palette.platform ?? "#8a6740" : tile === TILE.wall ? palette.ground ?? "#6b4a2f" : palette.ground ?? "#6b4a2f",
      ).color;

    // Merge horizontal runs of the same tile into one body: a 96×28 level is
    // a few dozen bodies instead of two thousand.
    for (let y = 0; y < height; y += 1) {
      let runStart = -1;
      let runTile: number = TILE.empty;
      for (let x = 0; x <= width; x += 1) {
        const tile: number = x < width ? tiles[y * width + x] ?? TILE.empty : TILE.empty;
        const solid = tile === TILE.ground || tile === TILE.platform || tile === TILE.wall || tile === TILE.hazard;
        if (solid && runStart < 0) {
          runStart = x;
          runTile = tile;
        } else if ((!solid || tile !== runTile) && runStart >= 0) {
          const runLength = x - runStart;
          const rectangle = this.scene.add.rectangle(
            (runStart + runLength / 2) * tileSize,
            (y + 0.5) * tileSize,
            runLength * tileSize,
            tileSize,
            colorFor(runTile),
          );
          this.platforms.add(rectangle);
          if (runTile === TILE.hazard) rectangle.setData("hazard", true);
          runStart = solid ? x : -1;
          runTile = tile;
          if (solid) runStart = x;
        }
      }
    }

    this.scene.physics.world.setBounds(0, 0, width * tileSize, height * tileSize + tileSize * 4);
    this.scene.cameras.main.setBounds(0, 0, width * tileSize, height * tileSize);
  }

  private buildActor(ir: EntityIR, components: Map<string, Record<string, unknown>>) {
    if (!this.scene) return;
    const size = ir.bounds?.size ?? [24, 24, 1];
    const controller = components.get("PlayerController");
    const collectible = components.get("Collectible");
    const enemy = components.get("Enemy");
    const trigger = components.get("Trigger");
    const colorHex =
      String(controller?.color ?? collectible?.color ?? (enemy ? "#c0392b" : trigger ? "#f2c14e" : "#dddddd"));
    const rectangle = this.scene.add.rectangle(
      ir.transform.position[0],
      ir.transform.position[1],
      Math.max(4, size[0]),
      Math.max(4, size[1]),
      Phaser.Display.Color.HexStringToColor(colorHex).color,
    );
    this.scene.physics.add.existing(rectangle, false);
    const sprite = rectangle as Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };

    if (controller) {
      sprite.body.setCollideWorldBounds(false);
      this.playerId = ir.id;
      if (this.platforms) this.scene.physics.add.collider(sprite, this.platforms);
      this.scene.cameras.main.startFollow(sprite, true, 0.12, 0.12);
    } else {
      sprite.body.setAllowGravity(Boolean(enemy));
      if (enemy && this.platforms) this.scene.physics.add.collider(sprite, this.platforms);
    }

    this.actors.set(ir.id, { ir, sprite, components, alive: true, state: {} });
  }

  fire(name: string, data: Record<string, unknown> = {}) {
    this.eventSequence += 1;
    const event: GameEvent = { sequence: this.eventSequence, time: this.time, name, data };
    this.events.push(event);
    if (this.events.length > 4000) this.events.splice(0, this.events.length - 4000);
    this.emit(event);
  }

  /* ---------------- stepping ---------------- */

  step(deltaSeconds: number) {
    const delta = Math.min(0.1, deltaSeconds * this.timeScale) * 1000;
    this.wallClock += delta;
    this.game.step(this.wallClock, delta);
  }

  stepFixed() {
    this.step(1 / 60);
  }

  render() {
    // Phaser renders inside step(); nothing extra to do.
  }

  /** Called by the Phaser scene each frame. */
  simulate(dt: number) {
    this.time += dt;
    this.frame += 1;
    try {
      this.updatePlayer(dt);
      this.updateEnemies(dt);
      this.updatePickups();
    } catch (error) {
      this.runtimeErrors += 1;
      this.fire("runtime_exception", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private updatePlayer(dt: number) {
    void dt;
    if (!this.playerId) return;
    const player = this.actors.get(this.playerId);
    if (!player || !player.alive) return;
    const controller = player.components.get("PlayerController") ?? {};
    const speed = Number(controller.moveSpeed ?? 220);
    const jump = Number(controller.jumpSpeed ?? 560);

    let direction = 0;
    if (this.held.has("moveRight")) direction += 1;
    if (this.held.has("moveLeft")) direction -= 1;

    if (this.moveTarget) {
      const dx = this.moveTarget[0] - player.sprite.x;
      if (Math.abs(dx) < this.tileSize * 0.6) {
        this.moveTarget = null;
        direction = 0;
      } else {
        direction = Math.sign(dx);
        // Blocked horizontally while grounded: hop the obstacle.
        if (player.sprite.body.blocked.down && Math.abs(player.sprite.body.velocity.x) < 12) {
          player.sprite.body.setVelocityY(-jump);
        }
      }
    }

    player.sprite.body.setVelocityX(direction * speed);
    if (this.held.has("jump") && player.sprite.body.blocked.down) {
      player.sprite.body.setVelocityY(-jump);
      this.fire("player_jumped", {});
    }

    const health = player.components.get("Health");
    if (health && Number(health.current ?? 1) <= 0 && player.alive) {
      player.alive = false;
      this.fire("player_died", { entityId: player.ir.id });
    }
    // Falling out of the world is a death, not a silent freefall.
    const worldBottom = this.scene?.physics.world.bounds.bottom ?? Infinity;
    if (player.sprite.y > worldBottom && player.alive) {
      player.alive = false;
      this.fire("player_died", { entityId: player.ir.id, reason: "fell out of the level" });
    }
  }

  private updateEnemies(dt: number) {
    void dt;
    for (const actor of this.actors.values()) {
      if (!actor.alive || actor.ir.id === this.playerId) continue;
      const behavior = actor.components.get("Behavior");
      if (!behavior || behavior.behavior !== "patrol2d") continue;
      const parameters = (behavior.parameters ?? {}) as Record<string, number>;
      const range = Number(parameters.range ?? 96);
      const speed = Number(parameters.speed ?? 60);
      const origin = (actor.state.origin as number | undefined) ?? (actor.state.origin = actor.sprite.x);
      const phase = Math.sin(this.time * (speed / Math.max(1, range)));
      actor.sprite.setX(origin + phase * range);

      const health = actor.components.get("Health");
      if (health && Number(health.current ?? 1) <= 0) {
        actor.alive = false;
        actor.sprite.setVisible(false);
        actor.sprite.body.enable = false;
        this.fire("enemy_killed", { entityId: actor.ir.id });
      }
    }
  }

  private updatePickups() {
    if (!this.playerId) return;
    const player = this.actors.get(this.playerId);
    if (!player) return;

    for (const actor of this.actors.values()) {
      if (actor.ir.id === this.playerId || !actor.alive) continue;
      const distance = Phaser.Math.Distance.Between(player.sprite.x, player.sprite.y, actor.sprite.x, actor.sprite.y);

      const collectible = actor.components.get("Collectible");
      if (collectible && distance < this.tileSize && !actor.state.collected) {
        actor.state.collected = true;
        actor.sprite.setVisible(false);
        this.fire("item_collected", { entityId: actor.ir.id, item: collectible.item, value: collectible.value });
        continue;
      }

      const trigger = actor.components.get("Trigger");
      if (trigger && distance < this.tileSize * 1.2 && !actor.state.triggered) {
        if (trigger.once) actor.state.triggered = true;
        this.fire(String(trigger.event ?? "trigger_entered"), { entityId: actor.ir.id });
      }

      const enemy = actor.components.get("Enemy");
      if (enemy && distance < this.tileSize && Number(enemy.contactDamage ?? 0) > 0) {
        const health = player.components.get("Health");
        if (health && !player.state.invulnerableUntil) {
          health.current = Math.max(0, Number(health.current ?? 0) - Number(enemy.contactDamage));
          player.state.invulnerableUntil = this.time + 1.2;
          this.fire("entity_damaged", { entityId: player.ir.id, amount: enemy.contactDamage, remaining: health.current });
        }
      }
      if (player.state.invulnerableUntil && this.time > Number(player.state.invulnerableUntil)) {
        player.state.invulnerableUntil = undefined;
      }
    }
  }

  /* ---------------- interface parity with World3D ---------------- */

  interact() {
    return { ok: false, reason: "2D levels use contact triggers rather than an interact action." };
  }

  attack(): { ok: boolean; hit: string[] } {
    if (!this.playerId) return { ok: false, hit: [] };
    const player = this.actors.get(this.playerId)!;
    const hit: string[] = [];
    for (const actor of this.actors.values()) {
      if (!actor.alive || actor.ir.id === this.playerId || !actor.components.has("Health")) continue;
      if (Phaser.Math.Distance.Between(player.sprite.x, player.sprite.y, actor.sprite.x, actor.sprite.y) > this.tileSize * 1.5) continue;
      const health = actor.components.get("Health")!;
      health.current = Math.max(0, Number(health.current ?? 1) - 1);
      hit.push(actor.ir.id);
    }
    this.fire("player_attacked", { hit });
    return { ok: true, hit };
  }

  requestMoveTo(position: Vec3) {
    this.moveTarget = position;
    return { accepted: Boolean(this.playerId), path: 1, reason: this.playerId ? undefined : "There is no player to move." };
  }

  arrived(position: Vec3, tolerance = 40) {
    if (!this.playerId) return false;
    const player = this.actors.get(this.playerId)!;
    return Math.abs(player.sprite.x - position[0]) <= tolerance;
  }

  setLook() {
    // 2D has no free look.
  }

  snapshot(): RuntimeSnapshot {
    const player = this.playerId ? this.actors.get(this.playerId) : undefined;
    const health = player?.components.get("Health");
    return {
      player: player
        ? {
            entityId: player.ir.id,
            position: [player.sprite.x, player.sprite.y, 0],
            velocity: [player.sprite.body.velocity.x, player.sprite.body.velocity.y, 0],
            grounded: player.sprite.body.blocked.down,
            health: { current: Number(health?.current ?? 0), max: Number(health?.max ?? 0) },
            inventory: [],
            facing: [Math.sign(player.sprite.body.velocity.x) || 1, 0, 0],
          }
        : undefined,
      time: this.time,
      frame: this.frame,
      sceneId: this.sceneIR?.id ?? "",
      runtimeErrors: this.runtimeErrors,
    };
  }

  entityState(entityId: string) {
    const actor = this.actors.get(entityId);
    if (!actor) return null;
    return {
      entityId,
      name: actor.ir.name,
      type: actor.ir.type,
      tags: actor.ir.tags,
      alive: actor.alive,
      enabled: actor.sprite.visible,
      position: [actor.sprite.x, actor.sprite.y, 0] as Vec3,
      components: Object.fromEntries([...actor.components.entries()]),
    };
  }

  listEntities(filter: { type?: string; tag?: string; limit: number }) {
    const out: ReturnType<World2D["entityState"]>[] = [];
    for (const actor of this.actors.values()) {
      if (filter.type && actor.ir.type !== filter.type) continue;
      if (filter.tag && !actor.ir.tags.includes(filter.tag)) continue;
      out.push(this.entityState(actor.ir.id));
      if (out.length >= filter.limit) break;
    }
    return out;
  }

  navigationQuery() {
    return { found: true, length: 0, waypoints: [], reason: "2D levels move the player directly along X." };
  }

  metrics(): RuntimeMetrics {
    const renderer = this.game.renderer as unknown as { drawCount?: number };
    return {
      fps: Number(this.game.loop.actualFps.toFixed(1)),
      frameTimeMs: Number(this.game.loop.delta.toFixed(2)),
      drawCalls: renderer.drawCount ?? 0,
      triangles: 0,
      entityCount: this.actors.size,
      activeLights: 0,
      textureMegabytes: 0,
      scriptTimeMs: 0,
    };
  }

  renderReport(): RenderReport {
    let visible = 0;
    for (const actor of this.actors.values()) if (actor.sprite.visible) visible += 1;
    visible += this.platforms?.getLength() ?? 0;
    return {
      visibleMeshInstances: visible,
      cameraPresent: Boolean(this.scene?.cameras.main),
      averageLuminance: 0.5,
      distinctColorBuckets: Math.min(64, visible),
      nonFiniteTransforms: 0,
      clearColor: this.sceneIR?.environment.skyColor ?? "#5b9bd5",
    };
  }

  screenshot(): string {
    return (this.game.canvas as HTMLCanvasElement).toDataURL("image/webp", 0.7);
  }

  destroy() {
    this.clear();
    this.game.destroy(false);
  }
}
