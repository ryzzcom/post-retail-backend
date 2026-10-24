import { Controller, Get } from '@nestjs/common';
import { Public } from '@core/decorators/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  healthCheck() {
    return {
      status: 'ok',
      service: 'pos-retail-backend',
    };
  }
}
