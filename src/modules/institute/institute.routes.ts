import express, { Router, type Request, type Response } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireAuthContext, requireFeature, type JwtVerifyOptions } from '../../shared/middlewares/auth.middleware';
import { validate } from '../../shared/middlewares/validate.middleware';
import { ok } from '../../shared/utils/api-response';
import { HttpError } from '../../shared/utils/http-error';
import { ASSET_SHEET_LIMITS } from './institute.excel';
import { INSTITUTE_ROLES, isInstituteRole } from './institute.access';
import type { AssetInput, AssetRow, AssetStatus, BranchRow, DepartmentRow, MaintenanceKind, MaintenanceRow, MemberRow, RoomInput, RoomKind, RoomRow, StaffInput, StaffRow } from './institute.repository';
import type { InstituteService, PublicAsset } from './institute.service';

const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

const departmentJson = (d: DepartmentRow) => ({ id: d.id, branch_id: d.branchId, name: d.name });
const staffJson = (s: StaffRow) => ({ id: s.id, branch_id: s.branchId, department_id: s.departmentId, full_name: s.fullName, job_title: s.jobTitle, phone: s.phone, email: s.email, active: s.active });
const maintenanceJson = (m: Omit<MaintenanceRow, 'cost'> & { cost?: string }) => ({
  id: m.id,
  asset_id: m.assetId,
  performed_on: m.performedOn,
  kind: m.kind,
  notes: m.notes,
  next_due_on: m.nextDueOn,
  // Absent for roles that may not see money.
  ...(m.cost !== undefined ? { cost: m.cost } : {}),
});
const staffRules = [
  body('full_name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('full_name is required'),
  body('department_id').optional({ values: 'null' }).isUUID(),
  body('job_title').optional({ values: 'null' }).isString().isLength({ max: 80 }),
  body('phone').optional({ values: 'null' }).isString().isLength({ max: 30 }),
  body('email').optional({ values: 'null' }).isEmail(),
  body('active').optional().isBoolean(),
];
const staffInput = (b: Record<string, unknown>, branchId: string): StaffInput => ({
  branchId,
  departmentId: str(b.department_id),
  fullName: String(b.full_name).trim(),
  jobTitle: str(b.job_title),
  phone: str(b.phone),
  email: str(b.email),
  active: b.active === undefined ? true : b.active === true || b.active === 'true',
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


  // ---- departments ----
  router.get('/institute/departments', auth, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ departments: (await service.listDepartments(tenantId, caller)).map(departmentJson) }));
  });
  router.post('/institute/departments', auth, body('name').isString().trim().isLength({ min: 1, max: 80 }), body('branch_id').optional({ values: 'null' }).isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    res.status(201).json(ok(departmentJson(await service.createDepartment(tenantId, caller, { branchId: str(b.branch_id), name: String(b.name).trim() }))));
  });
  router.delete('/institute/departments/:id', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteDepartment(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- staff ----
  router.get('/institute/staff', auth, query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ staff: (await service.listStaff(tenantId, caller, str(req.query.branch_id) ?? undefined)).map(staffJson) }));
  });
  router.post('/institute/staff', auth, body('branch_id').isUUID(), ...staffRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    res.status(201).json(ok(staffJson(await service.createStaff(tenantId, caller, staffInput(b, String(b.branch_id))))));
  });
  router.put('/institute/staff/:id', auth, uuid('id'), ...staffRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    res.json(ok(staffJson(await service.updateStaff(tenantId, caller, req.params.id as string, staffInput(req.body as Record<string, unknown>, '')))));
  });
  router.delete('/institute/staff/:id', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteStaff(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- asset maintenance and inventory ----
  router.get('/institute/assets/:id/maintenance', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ maintenance: (await service.listMaintenance(tenantId, caller, req.params.id as string)).map(maintenanceJson) }));
  });
  router.post(
    '/institute/assets/:id/maintenance',
    auth,
    uuid('id'),
    body('performed_on').isISO8601({ strict: true }).isLength({ min: 10, max: 10 }).withMessage('performed_on must be YYYY-MM-DD'),
    body('kind').optional().isIn(['INSPECTION', 'REPAIR', 'SERVICE']),
    body('cost').optional({ values: 'null' }).custom((v) => MONEY.test(String(v))).withMessage('cost must be an amount with at most 2 decimals'),
    body('next_due_on').optional({ values: 'null' }).isISO8601({ strict: true }).isLength({ min: 10, max: 10 }).withMessage('next_due_on must be YYYY-MM-DD'),
    body('notes').optional({ values: 'null' }).isString().isLength({ max: 500 }),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const performedOn = String(b.performed_on);
      const nextDueOn = str(b.next_due_on);
      if (nextDueOn && nextDueOn < performedOn) throw HttpError.unprocessable('INVALID_PERIOD', 'next_due_on must not be before performed_on');
      const saved = await service.logMaintenance(tenantId, caller, req.params.id as string, {
        performedOn,
        kind: (typeof b.kind === 'string' ? b.kind : 'SERVICE') as MaintenanceKind,
        cost: b.cost === undefined || b.cost === null ? '0.00' : Number(b.cost).toFixed(2),
        notes: str(b.notes),
        nextDueOn,
      });
      res.status(201).json(ok(maintenanceJson(saved)));
    },
  );
  router.get('/institute/inventory/attention', auth, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    // Saudi date (UTC+3, no daylight saving): overdue and end-of-life are judged by the local day.
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    noStore(res);
    res.json(ok({ today, items: (await service.inventoryAttention(tenantId, caller, today)).map((i) => ({ asset_id: i.assetId, reasons: i.reasons })) }));
  });

  // ---- Excel (assets) ----
  router.get('/institute/assets-export', auth, query('template').optional().isIn(['0', '1']), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const file = await service.exportAssets(tenantId, caller, req.query.template === '1');
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="institute-assets.xlsx"');
    noStore(res);
    res.send(file);
  });
  // The workbook arrives as the raw request body (application/octet-stream), like the health question import.
  router.post('/institute/assets-import', auth, express.raw({ type: () => true, limit: ASSET_SHEET_LIMITS.maxFileBytes }), async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw HttpError.unprocessable('FILE_REQUIRED', 'Upload an Excel or CSV file');
    const { tenantId, caller } = ctx(req);
    res.status(201).json(ok(await service.importAssets(tenantId, caller, req.body)));
  });

  return router;
}

export type { AssetRow };
