// ============================================================================
// File: services/service-container.js
// ============================================================================
/**
 * services/service-container.js
 * 服務容器 (IoC Container)
 * @version 9.3.2 (Phase 9.3.2: SQL Scaffolding Injection)
 * @date 2026-03-13
 * @changelog
 * - [PHASE 9.3.2] Injected contactSqlWriter into OpportunityService for SQL-safe contact scaffolding.
 * - [PHASE 9.3.1] Patched dependency injection wiring to securely provide systemService to OpportunityService, EventLogService, SalesAnalysisService, and ProductService.
 * - [PHASE 9.3] Verified and fixed all semantic RAW vs OFFICIAL mismatches in domain logic.
 * - [PHASE 9.3] Successfully and safely eradicated 100% of CORE Legacy Sheet Readers/Writers instantiations.
 * - [PHASE 9.3] Retained contactRawReader explicitly and exclusively for RAW (leads) mapping.
 */

const config = require('../config');
const dateHelpers = require('../utils/date-helpers');

// --- Import Infrastructure Services ---
const GoogleClientService = require('./google-client-service');

// --- Import Readers ---
const ContactReader = require('../data/contact-reader'); // EXCLUSIVELY FOR RAW
const ContactSqlReader = require('../data/contact-sql-reader');
const CompanySqlReader = require('../data/company-sql-reader');
const OpportunitySqlReader = require('../data/opportunity-sql-reader');
const InteractionSqlReader = require('../data/interaction-sql-reader');
const EventLogSqlReader = require('../data/event-log-sql-reader');
const SystemReader = require('../data/system-reader');
const WeeklyBusinessReader = require('../data/weekly-business-reader');
const WeeklyBusinessSqlReader = require('../data/weekly-business-sql-reader');
const AnnouncementReader = require('../data/announcement-reader');
const AnnouncementSqlReader = require('../data/announcement-sql-reader');
const ProductReader = require('../data/product-reader');

// --- Import Writers ---
const ContactWriter = require('../data/contact-writer'); // EXCLUSIVELY FOR RAW
const ContactSqlWriter = require('../data/contact-sql-writer');
const CompanySqlWriter = require('../data/company-sql-writer');
const OpportunitySqlWriter = require('../data/opportunity-sql-writer');
const InteractionSqlWriter = require('../data/interaction-sql-writer');
const EventLogSqlWriter = require('../data/event-log-sql-writer');
const SystemWriter = require('../data/system-writer');
const WeeklyBusinessWriter = require('../data/weekly-business-writer');
const WeeklyBusinessSqlWriter = require('../data/weekly-business-sql-writer');
const AnnouncementWriter = require('../data/announcement-writer');
const AnnouncementSqlWriter = require('../data/announcement-sql-writer');
const ProductWriter = require('../data/product-writer');

// --- Import Domain Services ---
const AuthService = require('./auth-service');
const DashboardService = require('./dashboard-service');
const OpportunityService = require('./opportunity-service');
const ContactService = require('./contact-service');
const CompanyService = require('./company-service');
const InteractionService = require('./interaction-service');
const EventLogService = require('./event-log-service');
const CalendarService = require('./calendar-service');
const SalesAnalysisService = require('./sales-analysis-service');
const WeeklyBusinessService = require('./weekly-business-service');
const WorkflowService = require('./workflow-service');
const ProductService = require('./product-service');
const AnnouncementService = require('./announcement-service');
const EventService = require('./event-service');
const SystemService = require('./system-service');

// --- Import Controllers ---
const AuthController = require('../controllers/auth.controller');
const SystemController = require('../controllers/system.controller');
const AnnouncementController = require('../controllers/announcement.controller');
const OpportunityController = require('../controllers/opportunity.controller');
const ContactController = require('../controllers/contact.controller');
const CompanyController = require('../controllers/company.controller');
const InteractionController = require('../controllers/interaction.controller');
const ProductController = require('../controllers/product.controller');
const WeeklyController = require('../controllers/weekly.controller');

let services = null;

async function initializeServices() {
    if (services) return services;

    console.log('🚀 [System] 正在初始化 Service Container (v9.3.2 SQL-Only CORE)...');

    try {
        // 1. Infrastructure
        const googleClientService = new GoogleClientService();
        const sheets = await googleClientService.getSheetsClient();
        const drive = await googleClientService.getDriveClient();
        const calendar = await googleClientService.getCalendarClient();

        // 2. Readers
        // RAW Keep
        const contactRawReader = new ContactReader(sheets, config.IDS.RAW); 
        
        // SQL Keep
        const contactSqlReader = new ContactSqlReader();
        const companySqlReader = new CompanySqlReader();
        const opportunitySqlReader = new OpportunitySqlReader();
        const interactionSqlReader = new InteractionSqlReader();
        const eventLogSqlReader = new EventLogSqlReader();

        // SYSTEM Keep
        const weeklyReader = new WeeklyBusinessReader(sheets, config.IDS.CORE);
        const weeklySqlReader = new WeeklyBusinessSqlReader();
        const announcementReader = new AnnouncementReader(sheets, config.IDS.CORE);
        const announcementSqlReader = new AnnouncementSqlReader();
        const systemReader = new SystemReader(sheets, config.IDS.SYSTEM);
        const productReader = new ProductReader(sheets, config.IDS.PRODUCT);

        // 3. Writers
        // RAW Keep
        const contactWriter = new ContactWriter(sheets, config.IDS.RAW, contactRawReader);
        
        // SQL Keep
        const contactSqlWriter = new ContactSqlWriter();
        const companySqlWriter = new CompanySqlWriter();
        const opportunitySqlWriter = new OpportunitySqlWriter();
        const interactionSqlWriter = new InteractionSqlWriter();
        const eventLogSqlWriter = new EventLogSqlWriter();

        // SYSTEM Keep
        const weeklyWriter = new WeeklyBusinessWriter(sheets, config.IDS.CORE, weeklyReader);
        const weeklySqlWriter = new WeeklyBusinessSqlWriter();
        const announcementWriter = new AnnouncementWriter(sheets, config.IDS.CORE, announcementReader);
        const announcementSqlWriter = new AnnouncementSqlWriter();
        const systemWriter = new SystemWriter(sheets, config.IDS.SYSTEM, systemReader);
        const productWriter = new ProductWriter(sheets, config.IDS.PRODUCT, productReader);

        // 4. Domain Services
        const calendarService = new CalendarService(calendar);
        const authService = new AuthService(systemReader, systemWriter);

        const announcementService = new AnnouncementService({
            announcementSqlReader,
            announcementSqlWriter
        });

        const systemService = new SystemService(systemReader, systemWriter);

        // DI Constructor Mapping: 
        // Official slots strictly mapped to SQL variants.
        const contactService = new ContactService(
            contactRawReader, // explicit RAW
            contactSqlReader, // contactCoreReader => SQL Official
            contactWriter,
            companySqlReader, 
            config,
            contactSqlReader,
            contactSqlWriter
        );

        const companyService = new CompanyService(
            companySqlReader,      // companyReader => SQL
            companySqlWriter,      // companyWriter => SQL
            contactSqlReader,      // contactReader => SQL
            contactWriter,
            opportunitySqlReader,  // opportunityReader => SQL
            opportunitySqlWriter,  // opportunityWriter => SQL
            interactionSqlReader,  // interactionReader => SQL
            interactionSqlWriter,  // interactionWriter => SQL
            eventLogSqlReader,     // eventLogReader => SQL
            systemReader,
            companySqlReader,
            contactService,        // ContactService exposes RAW getPotentialContacts securely
            companySqlWriter,
            eventLogSqlReader, 
            contactSqlReader,       
            opportunitySqlReader,   
            interactionSqlReader    
        );

        const opportunityService = new OpportunityService({
            config,
            opportunityWriter: opportunitySqlWriter, // opportunityWriter => SQL
            contactReader: contactSqlReader, // contactReader => SQL
            contactWriter,
            companyWriter: companySqlWriter, // companyWriter => SQL
            interactionReader: interactionSqlReader, // interactionReader => SQL
            interactionWriter: interactionSqlWriter, // interactionWriter => SQL
            eventLogReader: eventLogSqlReader, // eventLogReader => SQL
            systemReader,
            systemService, // [Patch 9.3.1] Wire newly required systemService
            opportunitySqlReader,
            opportunitySqlWriter,
            eventLogSqlReader,     
            companySqlReader,      
            interactionSqlReader,   
            contactSqlReader,
            contactSqlWriter // [PHASE 9.3.2] Inject for SQL contact scaffolding
        });

        const interactionService = new InteractionService(
            interactionSqlReader,
            interactionSqlWriter,
            opportunitySqlReader, 
            companySqlReader      
        );

        const eventLogService = new EventLogService(
            eventLogSqlReader, 
            opportunitySqlReader, 
            companySqlReader, 
            systemService, // [Patch 9.3.1] Replaced systemReader with systemService
            calendarService,
            eventLogSqlReader, 
            eventLogSqlWriter  
        );

        const weeklyBusinessService = new WeeklyBusinessService({
            weeklyBusinessReader: weeklyReader,
            weeklyBusinessSqlReader: weeklySqlReader,
            weeklyBusinessSqlWriter: weeklySqlWriter,
            dateHelpers,
            calendarService,
            systemService, 
            opportunityService,
            config
        });

        const salesAnalysisService = new SalesAnalysisService(
            opportunitySqlReader, 
            systemService, // [Patch 9.3.1] Replaced systemReader with systemService
            config
        );
        
        // [Patch 9.3.1] Appended systemService as 5th argument
        const productService = new ProductService(productReader, productWriter, systemReader, systemWriter, systemService);

        const dashboardService = new DashboardService(
            config,
            contactService,
            eventLogSqlReader,
            systemReader,
            weeklyBusinessService,
            calendarService,
            contactSqlReader,
            interactionSqlReader,
            companySqlReader,
            opportunitySqlReader,
            systemService
        );

        const workflowService = new WorkflowService(
            opportunityService,
            interactionService,
            contactService
        );

        const eventService = new EventService(
            calendarService,
            interactionService,
            weeklyBusinessService,
            opportunityService,
            config,
            dateHelpers
        );

        // 5. Controllers
        const authController = new AuthController(authService);
        const systemController = new SystemController(systemService, dashboardService);
        const announcementController = new AnnouncementController(announcementService);
        const contactController = new ContactController(contactService, workflowService, contactWriter);
        const companyController = new CompanyController(companyService);
        const opportunityController = new OpportunityController(
            opportunityService,
            workflowService,
            dashboardService,
            opportunitySqlReader, 
            opportunitySqlWriter  
        );
        const interactionController = new InteractionController(interactionService);
        const productController = new ProductController(productService);
        const weeklyController = new WeeklyController(weeklyBusinessService);

        console.log('✅ Service Container 初始化完成');

        services = {
            googleClientService,
            authService, contactService, companyService,
            opportunityService, interactionService, eventLogService, calendarService,
            weeklyBusinessService, salesAnalysisService, dashboardService,
            workflowService, productService,
            announcementService,
            eventService,
            systemService,
            authController,
            systemController,
            announcementController,
            contactController,
            companyController,
            opportunityController,
            interactionController,
            productController,
            weeklyController,
            contactWriter,
            contactRawReader,
            contactCoreReader: contactSqlReader, // Expose explicitly mapped SQL core
            weeklyBusinessReader: weeklyReader,
            weeklyBusinessWriter: weeklyWriter,
            systemReader, systemWriter,
            interactionWriter: interactionSqlWriter, 
            eventLogReader: eventLogSqlReader 
        };

        return services;

    } catch (error) {
        console.error('⚠ 系統啟動失敗 (Service Container):', error.message);
        console.error(error.stack);
        throw error;
    }
}

module.exports = initializeServices;