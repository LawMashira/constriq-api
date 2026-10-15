import { Module } from '@nestjs/common';
import { ClientsController, ConsultantsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  controllers: [ClientsController, ConsultantsController],
  providers: [ClientsService],
})
export class ClientsModule {}
