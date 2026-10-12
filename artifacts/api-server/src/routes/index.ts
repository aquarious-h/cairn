import { Router, type IRouter } from "express";
import healthRouter from "./health";
import careerRouter from "./career";

const router: IRouter = Router();

router.use(healthRouter);
router.use(careerRouter);

export default router;
