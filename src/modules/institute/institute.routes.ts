import { Router, type Request, type Response } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireAuthContext, requireFeature, type JwtVerifyOptions } from '../../shared/middlewares/auth.middleware';
import { validate } from '../../shared/middlewares/validate.middleware';
import { ok } from '../../shared/utils/api-response';
import { INSTITUTE_ROLES, isInstituteRole } from './institute.access';
import type { AssetInput, AssetRow, AssetStatus, BranchRow, MemberRow, RoomInput, RoomKind, RoomRow } from './institute.repository';
import type { InstituteService, PublicAsset } from './institute.service';

const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

const branchJson = (b: BranchRow) => ({ id: b.id, name: b.name, city: b.city, address: b.address, active: b.active });
const memberJson = (m: MemberRow) => ({ id: m.id, user_id: m.userId, email: m.email, full_name: m.fullName, role: m.role, branch_id: m.branchId });
const roomJson = (r: RoomRow) => ({ id: r.id, branch_id: r.branchId, name: r.name, kind: r.kind, area_m2: r.areaM2, capacity: r.capacity, power_kw: r.powerKw, active: r.active });
const assetJson = (a: PublicAsset) => ({
  id: a.id,
  branch_id: a.branchId,
  room_id: a.roomId,
  name: a.name,
  category: a.category,
  serial_no: a.serialNo,
  purchase_date: a.purchaseDate,
  status: a.status,
  notes: a.notes,
  // Absent (not null) for roles that may not see money, so the UI can tell "hidden" from "zero".
  ...(a.purchaseValue !== undefined ? { purchase_value: a.purchaseValue, salvage_percent: a.salvagePercent, useful_life_months: a.usefulLifeMonths } : {}),
});

const branchRules = [
  body('name').isString().trim().isLength({ min: 1, max: 80 }).withMessage('name is required'),
  body('city').optional({ values: 'null' }).isString().isLength({ max: 80 }),
  body('address').optional({ values: 'null' }).isString().isLength({ max: 200 }),
  body('active').optional().isBoolean(),
];
const roomRules = [
  body('name').isString().trim().isLength({ min: 1, max: 80 }).withMessage('name is required'),
  body('kind').optional().isIn(['CLASSROOM', 'LAB', 'HALL']),
  body('area_m2').isFloat({ gt: 0, max: 100_000 }).withMessage('area_m2 must be greater than 0'),
  body('capacity').isInt({ min: 1, max: 100_000 }).withMessage('capacity must be at least 1'),
  body('power_kw').optional({ values: 'null' }).isFloat({ min: 0, max: 100_000 }),
  body('active').optional().isBoolean(),
];
const assetRules = [
  body('name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('name is required'),
  body('room_id').optional({ values: 'null' }).isUUID(),
  body('category').optional({ values: 'null' }).isString().isLength({ max: 80 }),
  body('serial_no').optional({ values: 'null' }).isString().isLength({ max: 80 }),
  body('purchase_date').optional({ values: 'null' }).isISO8601({ strict: true }).isLength({ min: 10, max: 10 }).withMessage('purchase_date must be YYYY-MM-DD'),
  body('purchase_value').optional({ values: 'null' }).custom((v) => MONEY.test(String(v))).withMessage('purchase_value must be an amount with at most 2 decimals'),
  body('salvage_percent').optional({ values: 'null' }).isFloat({ min: 0, max: 100 }),
  body('useful_life_months').optional({ values: 'null' }).isInt({ min: 1, max: 1200 }),
  body('status').optional().isIn(['IN_SERVICE', 'MAINTENANCE', 'RETIRED']),
  body('notes').optional({ values: 'null' }).isString().isLength({ max: 500 }),
];

const roomInput = (b: Record<string, unknown>, branchId: string): RoomInput => ({
  branchId,
  name: String(b.name).trim(),
  kind: (typeof b.kind === 'string' ? b.kind : 'CLASSROOM') as RoomKind,
  areaM2: Number(b.area_m2).toFixed(2),
  capacity: Number(b.capacity),
  powerKw: Number(b.power_kw ?? 0).toFixed(2),
  active: b.active === undefined ? true : b.active === true || b.active === 'true',
});
const assetInput = (b: Record<string, unknown>, branchId: string): AssetInput => ({
  branchId,
  roomId: str(b.room_id),
  name: String(b.name).trim(),
  category: str(b.category),
  serialNo: str(b.serial_no),
  purchaseDate: str(b.purchase_date),
  purchaseValue: b.purchase_value === undefined || b.purchase_value === null ? '0.00' : Number(b.purchase_value).toFixed(2),
  salvagePercent: b.salvage_percent === undefined || b.salvage_percent === null ? '10.00' : Number(b.salvage_percent).toFixed(2),
  usefulLifeMonths: b.useful_life_months === undefined || b.useful_life_months === null ? null : Number(b.useful_life_months),
  status: (typeof b.status === 'string' ? b.status : 'IN_SERVICE') as AssetStatus,
  notes: str(b.notes),
});

/** Institute management endpoints. Every route: module switched on for the academy, signed-in user, role checked in the service. */
export function buildInstituteRouter(service: InstituteService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use('/institute', requireFeature('institute'));
  const auth = authenticate(jwt);
  const ctx = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, caller: { userId: user.id, userRole: user.role, ip: req.ip ?? null } };
  };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

  router.get('/institute/me', auth, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const m = await service.me(tenantId, caller);
    noStore(res);
    res.json(ok({ role: m.role, branch_id: m.branchId, can_write: m.canWrite }));
  });

  // ---- branches ----
  router.get('/institute/branches', auth, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ branches: (await service.listBranches(tenantId, caller)).map(branchJson) }));
  });
  router.post('/institute/branches', auth, ...branchRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    const created = await service.createBranch(tenantId, caller, { name: String(b.name).trim(), city: str(b.city), address: str(b.address), active: b.active === undefined ? true : b.active === true || b.active === 'true' });
    res.status(201).json(ok(branchJson(created)));
  });
  router.put('/institute/branches/:id', auth, uuid('id'), ...branchRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    const updated = await service.updateBranch(tenantId, caller, req.params.id as string, { name: String(b.name).trim(), city: str(b.city), address: str(b.address), active: b.active === undefined ? true : b.active === true || b.active === 'true' });
    res.json(ok(branchJson(updated)));
  });

  // ---- members (HQ only) ----
  router.get('/institute/members', auth, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ members: (await service.listMembers(tenantId, caller)).map(memberJson), roles: INSTITUTE_ROLES }));
  });
  router.put(
    '/institute/members',
    auth,
    body('email').isEmail().withMessage('email is required'),
    body('role').custom(isInstituteRole).withMessage('role is not valid'),
    body('branch_id').optional({ values: 'null' }).isUUID(),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const m = await service.saveMember(tenantId, caller, { email: String(b.email).trim(), role: b.role as never, branchId: str(b.branch_id) });
      res.json(ok(memberJson(m)));
    },
  );
  router.delete('/institute/members/:userId', auth, uuid('userId'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.removeMember(tenantId, caller, req.params.userId as string);
    res.status(204).end();
  });

  // ---- rooms ----
  router.get('/institute/rooms', auth, query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ rooms: (await service.listRooms(tenantId, caller, str(req.query.branch_id) ?? undefined)).map(roomJson) }));
  });
  router.post('/institute/rooms', auth, body('branch_id').isUUID(), ...roomRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    res.status(201).json(ok(roomJson(await service.createRoom(tenantId, caller, roomInput(b, String(b.branch_id))))));
  });
  router.put('/institute/rooms/:id', auth, uuid('id'), ...roomRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    // The branch is fixed at creation; the service ignores the placeholder.
    res.json(ok(roomJson(await service.updateRoom(tenantId, caller, req.params.id as string, roomInput(req.body as Record<string, unknown>, '')))));
  });
  router.delete('/institute/rooms/:id', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteRoom(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- assets ----
  router.get(
    '/institute/assets',
    auth,
    query('branch_id').optional().isUUID(),
    query('room_id').optional().isUUID(),
    query('status').optional().isIn(['IN_SERVICE', 'MAINTENANCE', 'RETIRED']),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const assets = await service.listAssets(tenantId, caller, {
        branchId: str(req.query.branch_id) ?? undefined,
        roomId: str(req.query.room_id) ?? undefined,
        status: (str(req.query.status) ?? undefined) as AssetStatus | undefined,
      });
      noStore(res);
      res.json(ok({ assets: assets.map(assetJson) }));
    },
  );
  router.post('/institute/assets', auth, body('branch_id').isUUID(), ...assetRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    res.status(201).json(ok(assetJson(await service.createAsset(tenantId, caller, assetInput(b, String(b.branch_id))))));
  });
  router.put('/institute/assets/:id', auth, uuid('id'), ...assetRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    res.json(ok(assetJson(await service.updateAsset(tenantId, caller, req.params.id as string, assetInput(req.body as Record<string, unknown>, '')))));
  });
  router.delete('/institute/assets/:id', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteAsset(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  return router;
}

export type { AssetRow };
